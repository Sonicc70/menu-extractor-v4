import { useState, useCallback } from 'react';
import { FileUpload } from './components/FileUpload';
import { MenuDisplay } from './components/MenuDisplay';
import { processFile } from './utils/fileProcessor';
import { extractMenuBoth, OpenRouterError } from './api/openRouter';
import type { AppState, FileItem, MenuData, MenuDataV2 } from './types';
import './App.css';

const INITIAL_STATE: AppState = {
  status: 'idle',
  files: [],
};

function makeFileItem(file: File): FileItem {
  return {
    id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
    file,
    fileName: file.name,
    status: 'pending',
    menu: null,
    menuV2: null,
    previewUrl: null,
    error: null,
  };
}

// ─── Merge helpers ────────────────────────────────────────────────────────────
function mergeMenuData(files: FileItem[]): MenuData {
  const merged: MenuData = [];
  const categoryMap = new Map<string, number>();
  for (const file of files) {
    if (file.status !== 'success' || !file.menu) continue;
    for (const category of file.menu) {
      const key = category.title.trim().toLowerCase();
      if (categoryMap.has(key)) {
        merged[categoryMap.get(key)!].entries.push(...category.entries);
      } else {
        categoryMap.set(key, merged.length);
        merged.push({ title: category.title, entries: [...category.entries] });
      }
    }
  }
  return merged;
}

function mergeMenuDataV2(files: FileItem[]): MenuDataV2 {
  const merged: MenuDataV2 = [];
  const categoryMap = new Map<string, number>();
  for (const file of files) {
    if (file.status !== 'success' || !file.menuV2) continue;
    for (const category of file.menuV2) {
      const key = category.name.trim().toLowerCase();
      if (categoryMap.has(key)) {
        const idx = categoryMap.get(key)!;
        const offset = merged[idx].menuItems.length;
        merged[idx].menuItems.push(
          ...category.menuItems.map((item) => ({ ...item, position: offset + item.position }))
        );
      } else {
        categoryMap.set(key, merged.length);
        merged.push({
          uuid: null,
          key: null,
          name: category.name,
          position: merged.length,
          menuItems: category.menuItems.map((item) => ({ ...item })),
        });
      }
    }
  }
  return merged;
}

// ─── Component ────────────────────────────────────────────────────────────────
export default function App() {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [enableJson, setEnableJson] = useState(true);
  const [enableJsonV2, setEnableJsonV2] = useState(true);

  const noneEnabled = !enableJson && !enableJsonV2;

  const handleFilesSelect = useCallback((incoming: File[]) => {
    setState((prev) => {
      const existingKeys = new Set(prev.files.map((f) => `${f.fileName}-${f.file.size}`));
      const newItems = incoming
        .filter((f) => !existingKeys.has(`${f.name}-${f.size}`))
        .map(makeFileItem);
      if (newItems.length === 0) return prev;
      return { status: 'ready', files: [...prev.files, ...newItems] };
    });
  }, []);

  const handleRemoveFile = useCallback((id: string) => {
    setState((prev) => {
      const next = prev.files.filter((f) => f.id !== id);
      return {
        status: next.length === 0 ? 'idle' : prev.status === 'done' ? 'done' : 'ready',
        files: next,
      };
    });
  }, []);

  // ─── Process a single file ─────────────────────────────────────────────────
  const processSingleFile = useCallback(
    async (item: FileItem, opts: { enableJson: boolean; enableJsonV2: boolean }) => {
      setState((prev) => ({
        ...prev,
        files: prev.files.map((f) =>
          f.id === item.id ? { ...f, status: 'processing' as const, error: null } : f
        ),
      }));

      try {
        const processed = await processFile(item.file);

        // Build the preview data URL from the already-processed base64.
        // For images this is the original file encoded; for PDFs it is the
        // rendered JPEG that fileProcessor already produced — no extra work.
        const previewUrl = `data:${processed.mimeType};base64,${processed.base64}`;

        const { menu, menuV2 } = await extractMenuBoth(
          processed.base64,
          processed.mimeType,
          opts
        );

        setState((prev) => ({
          ...prev,
          files: prev.files.map((f) =>
            f.id === item.id
              ? { ...f, status: 'success' as const, menu, menuV2, previewUrl }
              : f
          ),
        }));
      } catch (err) {
        const message =
          err instanceof OpenRouterError
            ? err.message
            : err instanceof Error
            ? err.message
            : 'An unexpected error occurred.';
        setState((prev) => ({
          ...prev,
          files: prev.files.map((f) =>
            f.id === item.id ? { ...f, status: 'error' as const, error: message } : f
          ),
        }));
      }
    },
    []
  );

  // ─── Extract all pending files sequentially ───────────────────────────────
  const handleExtract = useCallback(async () => {
    setState((prev) => {
      if (prev.status !== 'ready') return prev;
      return { ...prev, status: 'processing' };
    });

    const toProcess = state.files.filter((f) => f.status === 'pending');
    const opts = { enableJson, enableJsonV2 };

    for (const item of toProcess) {
      await processSingleFile(item, opts);
    }

    setState((prev) => ({ ...prev, status: 'done' }));
  }, [state.files, enableJson, enableJsonV2, processSingleFile]);

  // ─── Retry a single failed file ───────────────────────────────────────────
  const handleRetryFile = useCallback(
    async (id: string) => {
      const item = state.files.find((f) => f.id === id);
      if (!item) return;
      await processSingleFile(item, { enableJson, enableJsonV2 });
    },
    [state.files, enableJson, enableJsonV2, processSingleFile]
  );

  const handleReset = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  // ─── Inline edit callbacks ─────────────────────────────────────────────────
  const handleUpdateFileMenu = useCallback((fileId: string, updatedMenu: MenuData) => {
    setState((prev) => ({
      ...prev,
      files: prev.files.map((f) =>
        f.id === fileId ? { ...f, menu: updatedMenu } : f
      ),
    }));
  }, []);

  const handleUpdateFileMenuV2 = useCallback((fileId: string, updatedMenuV2: MenuDataV2) => {
    setState((prev) => ({
      ...prev,
      files: prev.files.map((f) =>
        f.id === fileId ? { ...f, menuV2: updatedMenuV2 } : f
      ),
    }));
  }, []);

  // ─── Derived state ─────────────────────────────────────────────────────────
  const { status, files } = state;

  const pendingCount = files.filter((f) => f.status === 'pending').length;
  const processingCount = files.filter((f) => f.status === 'processing').length;
  const successCount = files.filter((f) => f.status === 'success').length;
  const errorCount = files.filter((f) => f.status === 'error').length;
  const isExtracting = processingCount > 0;
  const hasSuccesses = successCount > 0;

  const mergedMenu = mergeMenuData(files);
  const mergedMenuV2 = mergeMenuDataV2(files);

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="app">
      <header className="app-header">
        <div className="logo-mark">▤</div>
        <div>
          <h1 className="app-title">Menu Extractor</h1>
        </div>
      </header>

      <main className="app-main">

        {/* ── Idle ── */}
        {status === 'idle' && (
          <div className="upload-section">
            <FileUpload onFilesSelect={handleFilesSelect} />
            <p className="hint-text">
              Upload one or more photos or PDF scans of a restaurant menu — all items will be
              merged into a single JSON output.
            </p>
          </div>
        )}

        {/* ── Ready / Processing / Done ── */}
        {(status === 'ready' || status === 'processing' || status === 'done') && (
          <div className="multi-section">

            {status !== 'processing' && (
              <FileUpload onFilesSelect={handleFilesSelect} disabled={isExtracting} compact />
            )}

            {/* ── File queue ── */}
            {files.length > 0 && (
              <div className="file-queue">
                <div className="file-queue-header">
                  <span className="file-queue-title">
                    {files.length} file{files.length !== 1 ? 's' : ''} queued
                  </span>
                  {status === 'ready' && (
                    <button className="clear-all-btn" onClick={handleReset}>
                      Clear all
                    </button>
                  )}
                </div>

                <div className="file-queue-list">
                  {files.map((item) => (
                    <div key={item.id} className={`file-queue-item status-${item.status}`}>
                      <div className="fq-icon">
                        {item.status === 'pending' && (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <rect x="2" y="1" width="9" height="14" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none"/>
                            <path d="M11 1l3 3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                            <rect x="11" y="1" width="3" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.4" fill="none"/>
                          </svg>
                        )}
                        {item.status === 'processing' && <div className="fq-spinner" />}
                        {item.status === 'success' && (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4" fill="none"/>
                            <path d="M4.5 8l2.5 2.5L11.5 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                          </svg>
                        )}
                        {item.status === 'error' && (
                          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                            <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.4" fill="none"/>
                            <path d="M8 5v3.5M8 11h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                          </svg>
                        )}
                      </div>

                      <div className="fq-info">
                        <span className="fq-name">{item.fileName}</span>
                        {item.status === 'pending' && <span className="fq-sub">Waiting</span>}
                        {item.status === 'processing' && (
                          <span className="fq-sub fq-sub--active">Extracting…</span>
                        )}
                        {item.status === 'success' && (
                          <span className="fq-sub fq-sub--success">
                            {item.menu
                              ? `${item.menu.reduce((s, c) => s + c.entries.length, 0)} items extracted`
                              : item.menuV2
                              ? `${item.menuV2.reduce((s, c) => s + c.menuItems.length, 0)} items extracted`
                              : 'Extracted'}
                          </span>
                        )}
                        {item.status === 'error' && (
                          <span className="fq-sub fq-sub--error" title={item.error ?? ''}>
                            Failed — {item.error?.slice(0, 60)}
                            {(item.error?.length ?? 0) > 60 ? '…' : ''}
                          </span>
                        )}
                      </div>

                      <div className="fq-actions">
                        {item.status === 'error' && (
                          <button
                            className="fq-action-btn retry"
                            onClick={() => handleRetryFile(item.id)}
                            title="Retry"
                          >
                            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                              <path d="M11 6.5A4.5 4.5 0 112 6.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                              <path d="M11 3.5V6.5H8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
                            </svg>
                          </button>
                        )}
                        {(item.status === 'pending' || item.status === 'error') && (
                          <button
                            className="fq-action-btn remove"
                            onClick={() => handleRemoveFile(item.id)}
                            title="Remove"
                          >
                            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                              <path d="M1.5 1.5l9 9M10.5 1.5l-9 9" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                            </svg>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Format toggles + Extract button ── */}
            {pendingCount > 0 && !isExtracting && (
              <div className="extract-panel">
                <div className="format-toggles">
                  <span className="format-toggles-label">Output formats</span>
                  <label className={`format-toggle ${enableJson ? 'enabled' : ''}`}>
                    <input
                      type="checkbox"
                      checked={enableJson}
                      onChange={(e) => setEnableJson(e.target.checked)}
                    />
                    <span className="format-toggle-pill">
                      <span className="format-toggle-dot" />
                      JSON
                    </span>
                  </label>
                  <label className={`format-toggle ${enableJsonV2 ? 'enabled' : ''}`}>
                    <input
                      type="checkbox"
                      checked={enableJsonV2}
                      onChange={(e) => setEnableJsonV2(e.target.checked)}
                    />
                    <span className="format-toggle-pill">
                      <span className="format-toggle-dot" />
                      JSON V2
                    </span>
                  </label>
                </div>

                {noneEnabled && (
                  <p className="format-warn">
                    ⚠ Select at least one output format before extracting.
                  </p>
                )}

                <button
                  className="extract-btn"
                  onClick={handleExtract}
                  disabled={noneEnabled}
                >
                  <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
                    <path d="M9 3v9M5.5 8.5L9 12l3.5-3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M3 15h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  Extract {pendingCount} Menu{pendingCount !== 1 ? 's' : ''}
                </button>
              </div>
            )}

            {/* ── Extracting progress ── */}
            {isExtracting && (
              <div className="extraction-progress">
                <div className="spinner-small" />
                <span>
                  Extracting… {successCount > 0 && `${successCount} done`}
                  {successCount > 0 && errorCount > 0 && ' · '}
                  {errorCount > 0 && `${errorCount} failed`}
                  {pendingCount > 0 && ` · ${pendingCount} waiting`}
                </span>
              </div>
            )}

            {/* ── Results ── */}
            {hasSuccesses && (
              <div className="result-section">
                <MenuDisplay
                  files={files}
                  mergedMenu={mergedMenu}
                  mergedMenuV2={mergedMenuV2}
                  showMerged={successCount > 1}
                  enableJson={enableJson}
                  enableJsonV2={enableJsonV2}
                  onUpdateFileMenu={handleUpdateFileMenu}
                  onUpdateFileMenuV2={handleUpdateFileMenuV2}
                />
              </div>
            )}

            {status === 'done' && (
              <div className="done-actions">
                <button className="new-upload-btn" onClick={handleReset}>
                  ↑ Start Over
                </button>
              </div>
            )}
          </div>
        )}

      </main>

      <footer className="app-footer">
        <span>Powered by Menu Extractor · Images processed client-side</span>
      </footer>
    </div>
  );
}
