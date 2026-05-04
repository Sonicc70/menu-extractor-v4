export interface ProcessedFile {
  base64: string;
  mimeType: string;
  fileName: string;
}

function fileToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip data URL prefix to get raw base64
      resolve(result.split(',')[1]);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(blob);
  });
}

async function pdfPageToBase64(file: File): Promise<string> {
  // Dynamically import pdfjs to keep bundle lean
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url
  ).toString();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  // Render all pages and stitch them vertically
  const canvases: HTMLCanvasElement[] = [];
  let totalHeight = 0;
  let maxWidth = 0;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: 2.0 }); // 2x for quality

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport }).promise;

    canvases.push(canvas);
    totalHeight += viewport.height;
    maxWidth = Math.max(maxWidth, viewport.width);
  }

  // Merge pages into a single canvas
  const merged = document.createElement('canvas');
  merged.width = maxWidth;
  merged.height = totalHeight;
  const mCtx = merged.getContext('2d')!;
  mCtx.fillStyle = '#ffffff';
  mCtx.fillRect(0, 0, maxWidth, totalHeight);

  let yOffset = 0;
  for (const c of canvases) {
    mCtx.drawImage(c, 0, yOffset);
    yOffset += c.height;
  }

  // Return as base64 JPEG
  const dataUrl = merged.toDataURL('image/jpeg', 0.92);
  return dataUrl.split(',')[1];
}

export async function processFile(file: File): Promise<ProcessedFile> {
  const isPdf = file.type === 'application/pdf';
  const isImage = file.type.startsWith('image/');

  if (!isPdf && !isImage) {
    throw new Error(`Unsupported file type: ${file.type}. Please upload an image (JPG, PNG, WEBP) or PDF.`);
  }

  if (file.size > 20 * 1024 * 1024) {
    throw new Error('File size exceeds 20MB limit. Please use a smaller file.');
  }

  if (isPdf) {
    const base64 = await pdfPageToBase64(file);
    return { base64, mimeType: 'image/jpeg', fileName: file.name };
  }

  const base64 = await fileToBase64(file);
  return { base64, mimeType: file.type, fileName: file.name };
}
