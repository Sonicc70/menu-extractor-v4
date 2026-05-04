import { useRef, useState, useCallback } from 'react';

interface FileUploadProps {
  onFilesSelect: (files: File[]) => void;
  disabled?: boolean;
  compact?: boolean;
}

const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const ACCEPTED_EXTENSIONS = '.jpg,.jpeg,.png,.webp,.pdf';

export function FileUpload({ onFilesSelect, disabled, compact }: FileUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const handleFiles = useCallback((rawFiles: FileList | File[]) => {
    const arr = Array.from(rawFiles);
    const valid = arr.filter(f => ACCEPTED_TYPES.includes(f.type));
    const invalid = arr.filter(f => !ACCEPTED_TYPES.includes(f.type));

    if (invalid.length > 0) {
      alert(
        `${invalid.length} file(s) were skipped (unsupported type):\n` +
        invalid.map(f => `• ${f.name}`).join('\n') +
        '\n\nSupported: JPG, PNG, WEBP, PDF'
      );
    }
    if (valid.length > 0) {
      onFilesSelect(valid);
    }
  }, [onFilesSelect]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files.length > 0) {
      handleFiles(e.dataTransfer.files);
    }
  }, [handleFiles]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFiles(e.target.files);
    }
    e.target.value = '';
  }, [handleFiles]);

  return (
    <div
      className={`upload-zone ${isDragging ? 'dragging' : ''} ${disabled ? 'disabled' : ''} ${compact ? 'compact' : ''}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onClick={() => !disabled && inputRef.current?.click()}
    >
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        multiple
        onChange={handleInputChange}
        style={{ display: 'none' }}
        disabled={disabled}
      />
      <div className="upload-icon">
        <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
          <rect x="6" y="8" width="28" height="36" rx="3" stroke="currentColor" strokeWidth="2" fill="none"/>
          <path d="M34 8l8 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
          <rect x="34" y="8" width="8" height="8" rx="1" stroke="currentColor" strokeWidth="2" fill="none"/>
          <path d="M24 22v12M19 27l5-5 5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      </div>
      <p className="upload-label">
        {isDragging ? 'Drop files here' : 'Drag & drop or click to upload'}
      </p>
      <p className="upload-sublabel">JPG · PNG · WEBP · PDF — multiple files supported</p>
    </div>
  );
}
