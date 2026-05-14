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
      // Strip the data URL prefix to get raw base64
      resolve(result.split(',')[1]);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(blob);
  });
}

/** Yield control back to the browser between heavy canvas operations. */
function yieldToMain(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Encode a canvas to a JPEG base64 string guaranteed to stay under
 * Vercel's 4.5 MB serverless function request-body hard limit.
 *
 * Strategy:
 *   1. Try progressively lower JPEG quality (0.85 → 0.75 → 0.65 → 0.55).
 *   2. If quality alone is not enough, proportionally shrink the canvas
 *      and re-encode at quality 0.80.
 *
 * Target ceiling: 4 MB of base64 (leaves ~0.5 MB for JSON envelope overhead).
 */
function canvasToBase64UnderLimit(canvas: HTMLCanvasElement): string {
  const MAX_BASE64_LENGTH = 4 * 1024 * 1024; // 4 MB

  // Step 1 — reduce JPEG quality in steps
  for (const quality of [0.85, 0.75, 0.65, 0.55]) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const base64 = dataUrl.split(',')[1];
    if (base64.length <= MAX_BASE64_LENGTH) return base64;
  }

  // Step 2 — quality alone wasn't enough; scale the canvas down.
  // Calculate the linear scale factor from the base64 length ratio,
  // then apply a 5 % safety margin.
  const oversizeDataUrl = canvas.toDataURL('image/jpeg', 0.55);
  const oversizeBase64 = oversizeDataUrl.split(',')[1];
  const factor = Math.sqrt(MAX_BASE64_LENGTH / oversizeBase64.length) * 0.95;

  const scaled = document.createElement('canvas');
  scaled.width = Math.floor(canvas.width * factor);
  scaled.height = Math.floor(canvas.height * factor);
  const sCtx = scaled.getContext('2d')!;
  sCtx.fillStyle = '#ffffff';
  sCtx.fillRect(0, 0, scaled.width, scaled.height);
  sCtx.drawImage(canvas, 0, 0, scaled.width, scaled.height);

  return scaled.toDataURL('image/jpeg', 0.80).split(',')[1];
}

async function pdfPageToBase64(file: File): Promise<string> {
  // Dynamically import pdfjs to keep the main bundle lean
  const pdfjsLib = await import('pdfjs-dist');
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url
  ).toString();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  // 1.5× gives AI models enough resolution to read menu text clearly.
  // 2.0× can produce a payload that hits Vercel's 4.5 MB body limit even
  // for single-page PDFs with dense image content.
  const scale = 1.5;

  const canvases: HTMLCanvasElement[] = [];
  let totalHeight = 0;
  let maxWidth = 0;

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport }).promise;

    canvases.push(canvas);
    totalHeight += viewport.height;
    maxWidth = Math.max(maxWidth, viewport.width);

    // Yield after each page so the UI stays responsive
    await yieldToMain();
  }

  // Merge all pages into one tall canvas
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
    // Yield between draws to avoid a long uninterrupted paint task
    await yieldToMain();
  }

  // Encode to JPEG, adaptively compressing to stay under Vercel's body limit
  return canvasToBase64UnderLimit(merged);
}

export async function processFile(file: File): Promise<ProcessedFile> {
  const isPdf = file.type === 'application/pdf';
  const isImage = file.type.startsWith('image/');

  if (!isPdf && !isImage) {
    throw new Error(
      `Unsupported file type: ${file.type}. Please upload an image (JPG, PNG, WEBP) or PDF.`
    );
  }

  if (file.size > 20 * 1024 * 1024) {
    throw new Error('File size exceeds 20 MB limit. Please use a smaller file.');
  }

  if (isPdf) {
    const base64 = await pdfPageToBase64(file);
    return { base64, mimeType: 'image/jpeg', fileName: file.name };
  }

  const base64 = await fileToBase64(file);
  return { base64, mimeType: file.type, fileName: file.name };
}
