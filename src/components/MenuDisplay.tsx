import { useState, useCallback, useRef, useEffect } from 'react';
import type { FileItem, MenuData, MenuDataV2 } from '../types';
import Swiper from 'swiper';
import { FreeMode, Mousewheel } from 'swiper/modules';

interface MenuDisplayProps {
  files: FileItem[];
  mergedMenu: MenuData;
  mergedMenuV2: MenuDataV2;
  showMerged: boolean;
  enableJson: boolean;
  enableJsonV2: boolean;
}

interface SingleMenuProps {
  menu: MenuData | null;
  menuV2: MenuDataV2 | null;
  fileName: string;
  label?: string;
  enableJson: boolean;
  enableJsonV2: boolean;
}

type TabId = 'visual' | 'json' | 'jsonv2';

// ─── Single Menu View ─────────────────────────────────────────────────────────
function SingleMenuView({ menu, menuV2, fileName, label, enableJson, enableJsonV2 }: SingleMenuProps) {
  const [copied, setCopied] = useState(false);

  const defaultTab: TabId = enableJson ? 'json' : enableJsonV2 ? 'jsonv2' : 'visual';
  const [activeTab, setActiveTab] = useState<TabId>('visual');

  const resolvedTab: TabId =
    (activeTab === 'json' && !enableJson) ||
    (activeTab === 'jsonv2' && !enableJsonV2)
      ? defaultTab
      : activeTab;

  const handleCopy = useCallback(() => {
    const content =
      resolvedTab === 'json' && menu
        ? JSON.stringify(menu, null, 2)
        : resolvedTab === 'jsonv2' && menuV2
        ? JSON.stringify(menuV2, null, 2)
        : '';

    if (!content) return;

    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [menu, menuV2, resolvedTab]);

  const totalItems = menu
    ? menu.reduce((sum, cat) => sum + cat.entries.length, 0)
    : menuV2
    ? menuV2.reduce((sum, cat) => sum + cat.menuItems.length, 0)
    : 0;

  const categoryCount = menu ? menu.length : menuV2 ? menuV2.length : 0;
  const copyLabel = resolvedTab === 'jsonv2' ? 'Copy JSON V2' : 'Copy JSON';
  const previewMenu = menu;

  return (
    <div className="single-menu-view">
      <div className="menu-view-meta">
        <span className="file-badge">{label ?? fileName}</span>
        <span className="stats-badge">{categoryCount} categories · {totalItems} items</span>
        <div className="tab-buttons">
          <button
            className={`tab-btn ${resolvedTab === 'visual' ? 'active' : ''}`}
            onClick={() => setActiveTab('visual')}
          >
            Preview
          </button>
          {enableJson && (
            <button
              className={`tab-btn ${resolvedTab === 'json' ? 'active' : ''}`}
              onClick={() => setActiveTab('json')}
            >
              JSON
            </button>
          )}
          {enableJsonV2 && (
            <button
              className={`tab-btn ${resolvedTab === 'jsonv2' ? 'active' : ''}`}
              onClick={() => setActiveTab('jsonv2')}
            >
              JSON V2
            </button>
          )}
        </div>
      </div>

      {resolvedTab === 'visual' && (
        <div className="menu-categories">
          {previewMenu ? (
            previewMenu.map((category, ci) => (
              <div key={ci} className="category-block">
                <h3 className="category-title">{category.title}</h3>
                <div className="entries-list">
                  {category.entries.map((entry, ei) => (
                    <div key={ei} className="entry-row">
                      <div className="entry-info">
                        <span className="entry-title">{entry.title}</span>
                        {entry.description && (
                          <span className="entry-desc">{entry.description}</span>
                        )}
                      </div>
                      {entry.price && (
                        <span className="entry-price">{entry.price}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : menuV2 ? (
            menuV2.map((category, ci) => (
              <div key={ci} className="category-block">
                <h3 className="category-title">{category.name}</h3>
                <div className="entries-list">
                  {category.menuItems.map((item, ei) => (
                    <div key={ei} className="entry-row">
                      <div className="entry-info">
                        <span className="entry-title">{item.title}</span>
                        {item.description && (
                          <span className="entry-desc">{item.description}</span>
                        )}
                      </div>
                      {item.price !== null && (
                        <span className="entry-price">{item.price}</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : null}
        </div>
      )}

      {resolvedTab === 'json' && enableJson && menu && (
        <div className="json-panel">
          <pre className="json-code">{JSON.stringify(menu, null, 2)}</pre>
        </div>
      )}

      {resolvedTab === 'jsonv2' && enableJsonV2 && menuV2 && (
        <div className="json-panel">
          <pre className="json-code">{JSON.stringify(menuV2, null, 2)}</pre>
        </div>
      )}

      <div className="menu-footer">
        <button
          className="copy-btn"
          onClick={handleCopy}
          style={{ visibility: resolvedTab === 'visual' ? 'hidden' : 'visible' }}
        >
          {copied ? (
            <>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Copied!
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
              {copyLabel}
            </>
          )}
        </button>
      </div>
    </div>
  );
}

// ─── Swipeable File Tabs ───────────────────────────────────────────────────────
interface SwipeableTabsProps {
  children: React.ReactNode;
  itemCount: number;
}

function SwipeableTabs({ children, itemCount }: SwipeableTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const swiperRef = useRef<Swiper | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    if (swiperRef.current) {
      swiperRef.current.destroy(true, true);
      swiperRef.current = null;
    }

    swiperRef.current = new Swiper(containerRef.current, {
      modules: [FreeMode, Mousewheel],
      slidesPerView: 'auto',
      freeMode: {
        enabled: true,
        momentum: true,
        momentumRatio: 0.6,
        momentumVelocityRatio: 0.6,
      },
      mousewheel: {
        enabled: true,
        forceToAxis: true,
        sensitivity: 1,
      },
      grabCursor: true,
      simulateTouch: true,
      touchStartPreventDefault: false,
    });

    return () => {
      swiperRef.current?.destroy(true, true);
      swiperRef.current = null;
    };
  }, [itemCount]);

  return (
    <div ref={containerRef} className="swiper menu-tabs-swiper">
      <div className="swiper-wrapper menu-file-tabs">
        {children}
      </div>
    </div>
  );
}

// ─── Menu Display ─────────────────────────────────────────────────────────────
export function MenuDisplay({
  files,
  mergedMenu,
  mergedMenuV2,
  showMerged,
  enableJson,
  enableJsonV2,
}: MenuDisplayProps) {
  const successFiles = files.filter(
    (f) => f.status === 'success' && (f.menu || f.menuV2)
  );
  const [activeFileId, setActiveFileId] = useState<string>('merged');

  if (successFiles.length === 0) return null;

  const resolvedId =
    showMerged && activeFileId === 'merged'
      ? 'merged'
      : successFiles.find((f) => f.id === activeFileId)
      ? activeFileId
      : successFiles[0]?.id ?? '';

  const activeFile =
    resolvedId !== 'merged' ? successFiles.find((f) => f.id === resolvedId) : null;

  const tabCount = successFiles.length + (showMerged ? 1 : 0);

  return (
    <div className="menu-display">
      <div className="menu-header">
        <SwipeableTabs itemCount={tabCount}>

          {showMerged && (
            <div className="swiper-slide menu-tab-slide">
              <button
                className={`menu-file-tab merged-tab ${resolvedId === 'merged' ? 'active' : ''}`}
                onClick={() => setActiveFileId('merged')}
                title="Combined from all files"
              >
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <circle cx="3" cy="6.5" r="2" stroke="currentColor" strokeWidth="1.3" fill="none"/>
                  <circle cx="10" cy="6.5" r="2" stroke="currentColor" strokeWidth="1.3" fill="none"/>
                  <path d="M5 6.5h3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
                <span className="menu-file-tab-name">Combined ({successFiles.length} files)</span>
              </button>
            </div>
          )}

          {successFiles.map((f) => (
            <div key={f.id} className="swiper-slide menu-tab-slide">
              <button
                className={`menu-file-tab ${resolvedId === f.id ? 'active' : ''}`}
                onClick={() => setActiveFileId(f.id)}
                title={f.fileName}
              >
                <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                  <rect x="1" y="1" width="8" height="11" rx="1" stroke="currentColor" strokeWidth="1.3" fill="none"/>
                  <path d="M9 1l3 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                  <rect x="9" y="1" width="3" height="3" rx="0.5" stroke="currentColor" strokeWidth="1.3" fill="none"/>
                </svg>
                <span className="menu-file-tab-name">{f.fileName}</span>
              </button>
            </div>
          ))}

        </SwipeableTabs>
      </div>

      {resolvedId === 'merged' && showMerged ? (
        <SingleMenuView
          key="merged"
          menu={enableJson ? mergedMenu : null}
          menuV2={enableJsonV2 ? mergedMenuV2 : null}
          fileName="combined"
          label={`Combined from ${successFiles.length} files`}
          enableJson={enableJson}
          enableJsonV2={enableJsonV2}
        />
      ) : (
        activeFile && (
          <SingleMenuView
            key={activeFile.id}
            menu={enableJson ? activeFile.menu : null}
            menuV2={enableJsonV2 ? activeFile.menuV2 : null}
            fileName={activeFile.fileName}
            enableJson={enableJson}
            enableJsonV2={enableJsonV2}
          />
        )
      )}
    </div>
  );
}
