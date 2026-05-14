import { useState, useRef, useEffect, useCallback } from 'react';
import type {
  FileItem,
  MenuCategory,
  MenuCategoryV2,
  MenuData,
  MenuDataV2,
  MenuEntry,
  MenuItemV2,
} from '../types';
import Swiper from 'swiper';
import { FreeMode, Mousewheel } from 'swiper/modules';

// ─── Interfaces ───────────────────────────────────────────────────────────────

interface MenuDisplayProps {
  files: FileItem[];
  mergedMenu: MenuData;
  mergedMenuV2: MenuDataV2;
  showMerged: boolean;
  enableJson: boolean;
  enableJsonV2: boolean;
  onUpdateFileMenu: (fileId: string, menu: MenuData) => void;
  onUpdateFileMenuV2: (fileId: string, menuV2: MenuDataV2) => void;
}

interface PreviewItem {
  url: string;
  label?: string;
}

interface SingleMenuProps {
  menu: MenuData | null;
  menuV2: MenuDataV2 | null;
  fileName: string;
  label?: string;
  enableJson: boolean;
  enableJsonV2: boolean;
  previewItems: PreviewItem[];
  /** Provided for individual files only; null in merged view → read-only. */
  onUpdateMenu: ((menu: MenuData) => void) | null;
  onUpdateMenuV2: ((menuV2: MenuDataV2) => void) | null;
  onReorderMenu: ((menu: MenuData) => void) | null;
  onReorderMenuV2: ((menuV2: MenuDataV2) => void) | null;
}

type TabId = 'visual' | 'json' | 'jsonv2';
type DragItem =
  | { kind: 'v1'; categoryIndex: number; itemIndex: number }
  | { kind: 'v2'; categoryIndex: number; itemIndex: number };

type DropTarget =
  | { kind: 'v1'; categoryIndex: number; itemIndex: number; placement: 'before' | 'after' }
  | { kind: 'v2'; categoryIndex: number; itemIndex: number; placement: 'before' | 'after' };

// ─── EditableField ────────────────────────────────────────────────────────────
// Renders as a <span> at rest; switches to <input> or <textarea> on click.
// Commits on blur or Enter (single-line), discards on Escape.

interface EditableFieldProps {
  value: string | number | null;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
  onCommit: (value: string) => void;
}

function EditableField({
  value,
  placeholder,
  className,
  multiline,
  onCommit,
}: EditableFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const display = value !== null && value !== undefined ? String(value) : '';

  function startEdit() {
    setDraft(display);
    setEditing(true);
  }

  useEffect(() => {
    if (!editing) return;
    if (multiline) {
      textareaRef.current?.focus();
    } else {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing, multiline]);

  function commit() {
    setEditing(false);
    onCommit(draft);
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' && !multiline) { e.preventDefault(); commit(); }
    if (e.key === 'Escape') { setEditing(false); }
  }

  if (editing) {
    const shared = {
      value: draft,
      placeholder,
      onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
        setDraft(e.target.value),
      onBlur: commit,
      onKeyDown: handleKeyDown,
      className: `editable-input${multiline ? ' multiline' : ''} ${className ?? ''}`,
    };
    return multiline
      ? <textarea ref={textareaRef} {...shared} rows={2} />
      : <input ref={inputRef} {...shared} />;
  }

  return (
    <span
      className={`editable-span ${className ?? ''} ${!display ? 'is-placeholder' : ''}`}
      onClick={startEdit}
      title="Click to edit"
    >
      {display || placeholder || ''}
    </span>
  );
}

// ─── Single Menu View ─────────────────────────────────────────────────────────
type ExportSource =
  | {
      kind: 'v1';
      label: 'JSON';
      slug: 'menu';
      jsonText: string;
      csvText: string;
    }
  | {
      kind: 'v2';
      label: 'JSON V2';
      slug: 'menu-v2';
      jsonText: string;
      csvText: string;
    };

function escapeCsvCell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  const escaped = text.replace(/"/g, '""');
  return /[",\r\n]/.test(text) ? `"${escaped}"` : escaped;
}

function buildCsv(rows: Array<Array<string | number | null | undefined>>): string {
  return rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n');
}

function menuToCsv(menu: MenuData): string {
  const rows: Array<Array<string | number | null | undefined>> = [
    ['category', 'item', 'description', 'price', 'category_position', 'item_position'],
  ];

  menu.forEach((category, categoryIndex) => {
    category.entries.forEach((entry, itemIndex) => {
      rows.push([
        category.title,
        entry.title,
        entry.description,
        entry.price,
        categoryIndex,
        itemIndex,
      ]);
    });
  });

  return buildCsv(rows);
}

function menuV2ToCsv(menuV2: MenuDataV2): string {
  const rows: Array<Array<string | number | null | undefined>> = [
    ['category', 'item', 'description', 'price', 'category_position', 'item_position'],
  ];

  menuV2.forEach((category) => {
    category.menuItems.forEach((item) => {
      rows.push([
        category.name,
        item.title,
        item.description,
        item.price,
        category.position,
        item.position,
      ]);
    });
  });

  return buildCsv(rows);
}

function sanitizeFileStem(fileName: string): string {
  const withoutExtension = fileName.replace(/\.[^./\\]+$/, '').trim();
  const slug = withoutExtension
    .replace(/[^a-z0-9]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();

  return slug || 'menu';
}

function downloadTextFile(fileName: string, content: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
}

function reorderList<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

function SingleMenuView({
  menu,
  menuV2,
  fileName,
  label,
  enableJson,
  enableJsonV2,
  previewItems,
  onUpdateMenu,
  onUpdateMenuV2,
  onReorderMenu,
  onReorderMenuV2,
}: SingleMenuProps) {
  const [copied, setCopied] = useState(false);
  const [copiedCategoryId, setCopiedCategoryId] = useState<string | null>(null);
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);

  const hasSource = previewItems.length > 0;
  const defaultTab: TabId = enableJson ? 'json' : enableJsonV2 ? 'jsonv2' : 'visual';
  const [activeTab, setActiveTab] = useState<TabId>('visual');

  const resolvedTab: TabId =
    (activeTab === 'json' && !enableJson) ||
    (activeTab === 'jsonv2' && !enableJsonV2)
      ? defaultTab
      : activeTab;

  const exportSource: ExportSource | null =
    resolvedTab === 'jsonv2' && menuV2
      ? {
          kind: 'v2',
          label: 'JSON V2',
          slug: 'menu-v2',
          jsonText: JSON.stringify(menuV2, null, 2),
          csvText: menuV2ToCsv(menuV2),
        }
      : resolvedTab === 'json' && menu
      ? {
          kind: 'v1',
          label: 'JSON',
          slug: 'menu',
          jsonText: JSON.stringify(menu, null, 2),
          csvText: menuToCsv(menu),
        }
      : null;

  const handleCopy = useCallback(() => {
    if (!exportSource) return;
    navigator.clipboard.writeText(exportSource.jsonText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [exportSource]);

  const handleDownloadJson = useCallback(() => {
    if (!exportSource) return;
    const fileStem = sanitizeFileStem(fileName);
    downloadTextFile(
      `${fileStem}-${exportSource.slug}.json`,
      exportSource.jsonText,
      'application/json;charset=utf-8'
    );
  }, [exportSource, fileName]);

  const handleExportCsv = useCallback(() => {
    if (!exportSource) return;
    const fileStem = sanitizeFileStem(fileName);
    downloadTextFile(
      `${fileStem}-${exportSource.slug}.csv`,
      exportSource.csvText,
      'text/csv;charset=utf-8'
    );
  }, [exportSource, fileName]);

  const handleCopyCategory = useCallback(
    (categoryId: string, categoryData: MenuCategory | MenuCategoryV2) => {
      navigator.clipboard.writeText(JSON.stringify(categoryData, null, 2)).then(() => {
        setCopiedCategoryId(categoryId);
        setTimeout(() => {
          setCopiedCategoryId((current) => (current === categoryId ? null : current));
        }, 2000);
      });
    },
    []
  );

  const clearDragState = useCallback(() => {
    setDragItem(null);
    setDropTarget(null);
  }, []);

  const totalItems = menu
    ? menu.reduce((s, c) => s + c.entries.length, 0)
    : menuV2
    ? menuV2.reduce((s, c) => s + c.menuItems.length, 0)
    : 0;

  const categoryCount = menu ? menu.length : menuV2 ? menuV2.length : 0;
  const canEdit = !!(onUpdateMenu || onUpdateMenuV2);
  const canReorderV1 = !!(menu && onReorderMenu);
  const canReorderV2 = !!(menuV2 && onReorderMenuV2);
  const copyLabel = exportSource ? `Copy ${exportSource.label}` : 'Copy JSON';
  const downloadLabel = exportSource ? `Download ${exportSource.label}` : 'Download JSON';

  // ── V1 edit helpers ────────────────────────────────────────────────────────
  function updateV1Entry(ci: number, ei: number, patch: Partial<MenuEntry>) {
    if (!menu || !onUpdateMenu) return;
    onUpdateMenu(menu.map((cat, i) =>
      i !== ci ? cat : {
        ...cat,
        entries: cat.entries.map((e, j) => j !== ei ? e : { ...e, ...patch }),
      }
    ));
  }
  function updateV1CategoryTitle(ci: number, title: string) {
    if (!menu || !onUpdateMenu) return;
    onUpdateMenu(menu.map((cat, i) => i !== ci ? cat : { ...cat, title }));
  }
  function deleteV1Entry(ci: number, ei: number) {
    if (!menu || !onUpdateMenu) return;
    onUpdateMenu(menu.map((cat, i) =>
      i !== ci ? cat : { ...cat, entries: cat.entries.filter((_, j) => j !== ei) }
    ));
  }
  function addV1Entry(ci: number) {
    if (!menu || !onUpdateMenu) return;
    onUpdateMenu(menu.map((cat, i) =>
      i !== ci ? cat : {
        ...cat,
        entries: [...cat.entries, { title: 'New Item', price: null, description: null }],
      }
    ));
  }
  function deleteV1Category(ci: number) {
    if (!menu || !onUpdateMenu) return;
    onUpdateMenu(menu.filter((_, i) => i !== ci));
  }

  function reorderV1Entries(
    categoryIndex: number,
    fromIndex: number,
    targetIndex: number,
    placement: 'before' | 'after'
  ) {
    if (!menu || !onReorderMenu) return;
    let insertIndex = targetIndex + (placement === 'after' ? 1 : 0);
    if (fromIndex < insertIndex) insertIndex -= 1;
    if (insertIndex === fromIndex) return;

    onReorderMenu(
      menu.map((category, index) =>
        index !== categoryIndex
          ? category
          : { ...category, entries: reorderList(category.entries, fromIndex, insertIndex) }
      )
    );
  }

  // ── V2 edit helpers ────────────────────────────────────────────────────────
  function updateV2Item(ci: number, ii: number, patch: Partial<MenuItemV2>) {
    if (!menuV2 || !onUpdateMenuV2) return;
    onUpdateMenuV2(menuV2.map((cat, i) =>
      i !== ci ? cat : {
        ...cat,
        menuItems: cat.menuItems.map((item, j) => j !== ii ? item : { ...item, ...patch }),
      }
    ));
  }
  function updateV2CategoryName(ci: number, name: string) {
    if (!menuV2 || !onUpdateMenuV2) return;
    onUpdateMenuV2(menuV2.map((cat, i) => i !== ci ? cat : { ...cat, name }));
  }
  function deleteV2Item(ci: number, ii: number) {
    if (!menuV2 || !onUpdateMenuV2) return;
    onUpdateMenuV2(menuV2.map((cat, i) =>
      i !== ci ? cat : { ...cat, menuItems: cat.menuItems.filter((_, j) => j !== ii) }
    ));
  }
  function addV2Item(ci: number) {
    if (!menuV2 || !onUpdateMenuV2) return;
    const cat = menuV2[ci];
    const position = cat.menuItems.length;
    onUpdateMenuV2(menuV2.map((c, i) =>
      i !== ci ? c : {
        ...c,
        menuItems: [
          ...c.menuItems,
          { uuid: null, key: null, position, title: 'New Item', description: null, price: null },
        ],
      }
    ));
  }
  function deleteV2Category(ci: number) {
    if (!menuV2 || !onUpdateMenuV2) return;
    onUpdateMenuV2(menuV2.filter((_, i) => i !== ci));
  }

  function reorderV2Items(
    categoryIndex: number,
    fromIndex: number,
    targetIndex: number,
    placement: 'before' | 'after'
  ) {
    if (!menuV2 || !onReorderMenuV2) return;
    let insertIndex = targetIndex + (placement === 'after' ? 1 : 0);
    if (fromIndex < insertIndex) insertIndex -= 1;
    if (insertIndex === fromIndex) return;

    onReorderMenuV2(
      menuV2.map((category, index) => {
        if (index !== categoryIndex) return category;
        const reordered = reorderList(category.menuItems, fromIndex, insertIndex).map((item, itemIndex) => ({
          ...item,
          position: itemIndex,
        }));
        return { ...category, menuItems: reordered };
      })
    );
  }

  function getDropPlacement(event: React.DragEvent<HTMLElement>): 'before' | 'after' {
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY - bounds.top > bounds.height / 2 ? 'after' : 'before';
  }

  function handleDragStart(item: DragItem, event: React.DragEvent<HTMLElement>) {
    event.dataTransfer.effectAllowed = 'move';
    setDragItem(item);
    setDropTarget(null);
  }

  function handleDragOver(event: React.DragEvent<HTMLElement>, target: Omit<DropTarget, 'placement'>) {
    if (!dragItem) return;
    if (dragItem.kind !== target.kind || dragItem.categoryIndex !== target.categoryIndex) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget({ ...target, placement: getDropPlacement(event) });
  }

  function handleDrop(event: React.DragEvent<HTMLElement>, target: Omit<DropTarget, 'placement'>) {
    if (!dragItem) return;
    if (dragItem.kind !== target.kind || dragItem.categoryIndex !== target.categoryIndex) return;
    event.preventDefault();
    const placement = getDropPlacement(event);

    if (dragItem.kind === 'v1') {
      reorderV1Entries(target.categoryIndex, dragItem.itemIndex, target.itemIndex, placement);
    } else {
      reorderV2Items(target.categoryIndex, dragItem.itemIndex, target.itemIndex, placement);
    }

    clearDragState();
  }

  return (
    <div className="single-menu-view">

      {/* ── Meta bar ── */}
      <div className="menu-view-meta">
        <span className="file-badge">{label ?? fileName}</span>
        <span className="stats-badge">{categoryCount} categories · {totalItems} items</span>
        {canEdit && resolvedTab === 'visual' && (
          <span className="edit-hint-badge">✎ Click any field to edit</span>
        )}
        {(canReorderV1 || canReorderV2) && resolvedTab === 'visual' && (
          <span className="edit-hint-badge">Drag handle to reorder</span>
        )}
        <div className="tab-buttons">
          <button className={`tab-btn ${resolvedTab === 'visual' ? 'active' : ''}`}
            onClick={() => setActiveTab('visual')}>Preview</button>
          {enableJson && (
            <button className={`tab-btn ${resolvedTab === 'json' ? 'active' : ''}`}
              onClick={() => setActiveTab('json')}>JSON</button>
          )}
          {enableJsonV2 && (
            <button className={`tab-btn ${resolvedTab === 'jsonv2' ? 'active' : ''}`}
              onClick={() => setActiveTab('jsonv2')}>JSON V2</button>
          )}
        </div>
      </div>

      {/* ── Content area ── */}
      <div className={`menu-content-area${hasSource ? ' split-layout' : ''}`}>

        {/* Left: source image */}
        {hasSource && (
          <div className="source-split-panel">
            {previewItems.map((item, i) => (
              <div key={i} className="source-image-wrapper">
                {item.label && <div className="source-image-label">{item.label}</div>}
                <img src={item.url} alt={item.label ?? `Source ${i + 1}`}
                  className="source-image" draggable={false} />
              </div>
            ))}
          </div>
        )}

        {/* Right: extracted data */}
        <div className="content-split-panel">

          {/* ── Preview tab ── */}
          {resolvedTab === 'visual' && (
            <div className="menu-categories">

              {/* Editable V1 */}
              {menu && onUpdateMenu ? (
                menu.map((category, ci) => (
                  <div key={ci} className="category-block">
                    <div className="category-header">
                      <EditableField
                        value={category.title}
                        className="category-title"
                        placeholder="Category name"
                        onCommit={(val) => updateV1CategoryTitle(ci, val.toUpperCase())}
                      />
                      <div className="category-header-actions">
                        <button
                          className="category-copy-btn"
                          onClick={() => handleCopyCategory(`v1-${ci}`, category)}
                          title="Copy category as JSON"
                        >
                          {copiedCategoryId === `v1-${ci}` ? 'Copied!' : 'Copy category'}
                        </button>
                        <button
                          className="delete-category-btn"
                          onClick={() => deleteV1Category(ci)}
                          title="Delete category"
                        >
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="entries-list">
                      {category.entries.map((entry, ei) => (
                        <div
                          key={ei}
                          className={`entry-row editable${dropTarget?.kind === 'v1' && dropTarget.categoryIndex === ci && dropTarget.itemIndex === ei ? ` drop-${dropTarget.placement}` : ''}`}
                          onDragOver={canReorderV1 ? (event) => handleDragOver(event, { kind: 'v1', categoryIndex: ci, itemIndex: ei }) : undefined}
                          onDrop={canReorderV1 ? (event) => handleDrop(event, { kind: 'v1', categoryIndex: ci, itemIndex: ei }) : undefined}
                        >
                          <div className="entry-info">
                            <div className="entry-title-row">
                              {canReorderV1 && (
                                <button
                                  type="button"
                                  className="drag-handle-btn"
                                  draggable
                                  onDragStart={(event) => handleDragStart({ kind: 'v1', categoryIndex: ci, itemIndex: ei }, event)}
                                  onDragEnd={clearDragState}
                                  title="Drag to reorder"
                                >
                                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                    <circle cx="3" cy="3" r="1" fill="currentColor" />
                                    <circle cx="9" cy="3" r="1" fill="currentColor" />
                                    <circle cx="3" cy="6" r="1" fill="currentColor" />
                                    <circle cx="9" cy="6" r="1" fill="currentColor" />
                                    <circle cx="3" cy="9" r="1" fill="currentColor" />
                                    <circle cx="9" cy="9" r="1" fill="currentColor" />
                                  </svg>
                                </button>
                              )}
                              <EditableField
                                value={entry.title}
                                className="entry-title"
                                placeholder="Item name"
                                onCommit={(val) => updateV1Entry(ci, ei, { title: val })}
                              />
                            </div>
                            <EditableField
                              value={entry.description}
                              className="entry-desc"
                              placeholder="Add description…"
                              multiline
                              onCommit={(val) =>
                                updateV1Entry(ci, ei, { description: val || null })
                              }
                            />
                          </div>
                          <div className="entry-actions">
                            <EditableField
                              value={entry.price}
                              className="entry-price"
                              placeholder="—"
                              onCommit={(val) =>
                                updateV1Entry(ci, ei, { price: val || null })
                              }
                            />
                            <button
                              className="delete-entry-btn"
                              onClick={() => deleteV1Entry(ci, ei)}
                              title="Delete item"
                            >
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button className="add-entry-btn" onClick={() => addV1Entry(ci)}>
                      + Add item
                    </button>
                  </div>
                ))

              /* Editable V2 */
              ) : menuV2 && onUpdateMenuV2 ? (
                menuV2.map((category, ci) => (
                  <div key={ci} className="category-block">
                    <div className="category-header">
                      <EditableField
                        value={category.name}
                        className="category-title"
                        placeholder="Category name"
                        onCommit={(val) => updateV2CategoryName(ci, val.toUpperCase())}
                      />
                      <div className="category-header-actions">
                        <button
                          className="category-copy-btn"
                          onClick={() => handleCopyCategory(`v2-${ci}`, category)}
                          title="Copy category as JSON"
                        >
                          {copiedCategoryId === `v2-${ci}` ? 'Copied!' : 'Copy category'}
                        </button>
                        <button
                          className="delete-category-btn"
                          onClick={() => deleteV2Category(ci)}
                          title="Delete category"
                        >
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                          </svg>
                        </button>
                      </div>
                    </div>
                    <div className="entries-list">
                      {category.menuItems.map((item, ii) => (
                        <div
                          key={ii}
                          className={`entry-row editable${dropTarget?.kind === 'v2' && dropTarget.categoryIndex === ci && dropTarget.itemIndex === ii ? ` drop-${dropTarget.placement}` : ''}`}
                          onDragOver={canReorderV2 ? (event) => handleDragOver(event, { kind: 'v2', categoryIndex: ci, itemIndex: ii }) : undefined}
                          onDrop={canReorderV2 ? (event) => handleDrop(event, { kind: 'v2', categoryIndex: ci, itemIndex: ii }) : undefined}
                        >
                          <div className="entry-info">
                            <div className="entry-title-row">
                              {canReorderV2 && (
                                <button
                                  type="button"
                                  className="drag-handle-btn"
                                  draggable
                                  onDragStart={(event) => handleDragStart({ kind: 'v2', categoryIndex: ci, itemIndex: ii }, event)}
                                  onDragEnd={clearDragState}
                                  title="Drag to reorder"
                                >
                                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                    <circle cx="3" cy="3" r="1" fill="currentColor" />
                                    <circle cx="9" cy="3" r="1" fill="currentColor" />
                                    <circle cx="3" cy="6" r="1" fill="currentColor" />
                                    <circle cx="9" cy="6" r="1" fill="currentColor" />
                                    <circle cx="3" cy="9" r="1" fill="currentColor" />
                                    <circle cx="9" cy="9" r="1" fill="currentColor" />
                                  </svg>
                                </button>
                              )}
                              <EditableField
                                value={item.title}
                                className="entry-title"
                                placeholder="Item name"
                                onCommit={(val) => updateV2Item(ci, ii, { title: val })}
                              />
                            </div>
                            <EditableField
                              value={item.description}
                              className="entry-desc"
                              placeholder="Add description…"
                              multiline
                              onCommit={(val) =>
                                updateV2Item(ci, ii, { description: val || null })
                              }
                            />
                          </div>
                          <div className="entry-actions">
                            <EditableField
                              value={item.price}
                              className="entry-price"
                              placeholder="—"
                              onCommit={(val) => {
                                const parsed = parseFloat(val);
                                updateV2Item(ci, ii, {
                                  price: val && !isNaN(parsed) ? parsed : null,
                                });
                              }}
                            />
                            <button
                              className="delete-entry-btn"
                              onClick={() => deleteV2Item(ci, ii)}
                              title="Delete item"
                            >
                              <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                                <path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                              </svg>
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                    <button className="add-entry-btn" onClick={() => addV2Item(ci)}>
                      + Add item
                    </button>
                  </div>
                ))

              /* Read-only V1 (merged view) */
              ) : menu ? (
                menu.map((category, ci) => (
                  <div key={ci} className="category-block">
                    <div className="category-header">
                      <h3 className="category-title">{category.title}</h3>
                      <div className="category-header-actions">
                        <button
                          className="category-copy-btn"
                          onClick={() => handleCopyCategory(`merged-v1-${ci}`, category)}
                          title="Copy category as JSON"
                        >
                          {copiedCategoryId === `merged-v1-${ci}` ? 'Copied!' : 'Copy category'}
                        </button>
                      </div>
                    </div>
                    <div className="entries-list">
                      {category.entries.map((entry, ei) => (
                        <div
                          key={ei}
                          className={`entry-row${dropTarget?.kind === 'v1' && dropTarget.categoryIndex === ci && dropTarget.itemIndex === ei ? ` drop-${dropTarget.placement}` : ''}`}
                          onDragOver={canReorderV1 ? (event) => handleDragOver(event, { kind: 'v1', categoryIndex: ci, itemIndex: ei }) : undefined}
                          onDrop={canReorderV1 ? (event) => handleDrop(event, { kind: 'v1', categoryIndex: ci, itemIndex: ei }) : undefined}
                        >
                          <div className="entry-info">
                            <div className="entry-title-row">
                              {canReorderV1 && (
                                <button
                                  type="button"
                                  className="drag-handle-btn"
                                  draggable
                                  onDragStart={(event) => handleDragStart({ kind: 'v1', categoryIndex: ci, itemIndex: ei }, event)}
                                  onDragEnd={clearDragState}
                                  title="Drag to reorder"
                                >
                                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                    <circle cx="3" cy="3" r="1" fill="currentColor" />
                                    <circle cx="9" cy="3" r="1" fill="currentColor" />
                                    <circle cx="3" cy="6" r="1" fill="currentColor" />
                                    <circle cx="9" cy="6" r="1" fill="currentColor" />
                                    <circle cx="3" cy="9" r="1" fill="currentColor" />
                                    <circle cx="9" cy="9" r="1" fill="currentColor" />
                                  </svg>
                                </button>
                              )}
                              <span className="entry-title">{entry.title}</span>
                            </div>
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

              /* Read-only V2 (merged view) */
              ) : menuV2 ? (
                menuV2.map((category, ci) => (
                  <div key={ci} className="category-block">
                    <div className="category-header">
                      <h3 className="category-title">{category.name}</h3>
                      <div className="category-header-actions">
                        <button
                          className="category-copy-btn"
                          onClick={() => handleCopyCategory(`merged-v2-${ci}`, category)}
                          title="Copy category as JSON"
                        >
                          {copiedCategoryId === `merged-v2-${ci}` ? 'Copied!' : 'Copy category'}
                        </button>
                      </div>
                    </div>
                    <div className="entries-list">
                      {category.menuItems.map((item, ii) => (
                        <div
                          key={ii}
                          className={`entry-row${dropTarget?.kind === 'v2' && dropTarget.categoryIndex === ci && dropTarget.itemIndex === ii ? ` drop-${dropTarget.placement}` : ''}`}
                          onDragOver={canReorderV2 ? (event) => handleDragOver(event, { kind: 'v2', categoryIndex: ci, itemIndex: ii }) : undefined}
                          onDrop={canReorderV2 ? (event) => handleDrop(event, { kind: 'v2', categoryIndex: ci, itemIndex: ii }) : undefined}
                        >
                          <div className="entry-info">
                            <div className="entry-title-row">
                              {canReorderV2 && (
                                <button
                                  type="button"
                                  className="drag-handle-btn"
                                  draggable
                                  onDragStart={(event) => handleDragStart({ kind: 'v2', categoryIndex: ci, itemIndex: ii }, event)}
                                  onDragEnd={clearDragState}
                                  title="Drag to reorder"
                                >
                                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                                    <circle cx="3" cy="3" r="1" fill="currentColor" />
                                    <circle cx="9" cy="3" r="1" fill="currentColor" />
                                    <circle cx="3" cy="6" r="1" fill="currentColor" />
                                    <circle cx="9" cy="6" r="1" fill="currentColor" />
                                    <circle cx="3" cy="9" r="1" fill="currentColor" />
                                    <circle cx="9" cy="9" r="1" fill="currentColor" />
                                  </svg>
                                </button>
                              )}
                              <span className="entry-title">{item.title}</span>
                            </div>
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

          {/* JSON tab */}
          {resolvedTab === 'json' && enableJson && menu && (
            <div className="json-panel">
              <pre className="json-code">{JSON.stringify(menu, null, 2)}</pre>
            </div>
          )}

          {/* JSON V2 tab */}
          {resolvedTab === 'jsonv2' && enableJsonV2 && menuV2 && (
            <div className="json-panel">
              <pre className="json-code">{JSON.stringify(menuV2, null, 2)}</pre>
            </div>
          )}

        </div>
      </div>

      {/* ── Footer ── */}
      <div className="menu-footer">
        {exportSource && (
          <>
            <div className="menu-footer-actions menu-footer-actions-left">
              <button className="menu-action-btn" onClick={handleDownloadJson}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2.5v7M5.5 7.5L8 10l2.5-2.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M3 13h10" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"/>
                </svg>
                {downloadLabel}
              </button>
              <button className="menu-action-btn" onClick={handleExportCsv}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                  <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" stroke="currentColor" strokeWidth="1.4" fill="none"/>
                  <path d="M2.5 6h11M6 2.5v11" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round"/>
                </svg>
                Export CSV
              </button>
            </div>
            <div className="menu-footer-actions menu-footer-actions-right">
              <button className="menu-action-btn" onClick={handleCopy}>
              {copied ? (
                <>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <path d="M3 8l3.5 3.5L13 5" stroke="currentColor" strokeWidth="2"
                      strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" fill="none"/>
                    <path d="M11 5V3.5A1.5 1.5 0 009.5 2h-6A1.5 1.5 0 002 3.5v6A1.5 1.5 0 003.5 11H5"
                      stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                  </svg>
                  {copyLabel}
                </>
              )}
            </button>
            </div>
          </>
        )}
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
    if (swiperRef.current) { swiperRef.current.destroy(true, true); swiperRef.current = null; }
    swiperRef.current = new Swiper(containerRef.current, {
      modules: [FreeMode, Mousewheel],
      slidesPerView: 'auto',
      freeMode: { enabled: true, momentum: true, momentumRatio: 0.6, momentumVelocityRatio: 0.6 },
      mousewheel: { enabled: true, forceToAxis: true, sensitivity: 1 },
      grabCursor: true,
      simulateTouch: true,
      touchStartPreventDefault: false,
    });
    return () => { swiperRef.current?.destroy(true, true); swiperRef.current = null; };
  }, [itemCount]);

  return (
    <div ref={containerRef} className="swiper menu-tabs-swiper">
      <div className="swiper-wrapper menu-file-tabs">{children}</div>
    </div>
  );
}

// ─── Menu Display ─────────────────────────────────────────────────────────────
export function MenuDisplay({
  files, mergedMenu, mergedMenuV2, showMerged, enableJson, enableJsonV2,
  onUpdateFileMenu, onUpdateFileMenuV2,
}: MenuDisplayProps) {
  const successFiles = files.filter((f) => f.status === 'success' && (f.menu || f.menuV2));
  const [activeFileId, setActiveFileId] = useState<string>('merged');
  const [mergedMenuState, setMergedMenuState] = useState<MenuData>(mergedMenu);
  const [mergedMenuV2State, setMergedMenuV2State] = useState<MenuDataV2>(mergedMenuV2);

  useEffect(() => {
    setMergedMenuState(mergedMenu);
  }, [mergedMenu]);

  useEffect(() => {
    setMergedMenuV2State(mergedMenuV2);
  }, [mergedMenuV2]);

  if (successFiles.length === 0) return null;

  const resolvedId =
    showMerged && activeFileId === 'merged'
      ? 'merged'
      : successFiles.find((f) => f.id === activeFileId)
      ? activeFileId
      : successFiles[0]?.id ?? '';

  const activeFile = resolvedId !== 'merged'
    ? successFiles.find((f) => f.id === resolvedId)
    : null;

  const tabCount = successFiles.length + (showMerged ? 1 : 0);

  const mergedPreviewItems: PreviewItem[] = successFiles
    .filter((f) => f.previewUrl !== null)
    .map((f) => ({ url: f.previewUrl!, label: f.fileName }));

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
          menu={enableJson ? mergedMenuState : null}
          menuV2={enableJsonV2 ? mergedMenuV2State : null}
          fileName="combined"
          label={`Combined from ${successFiles.length} files`}
          enableJson={enableJson}
          enableJsonV2={enableJsonV2}
          previewItems={mergedPreviewItems}
          onUpdateMenu={null}
          onUpdateMenuV2={null}
          onReorderMenu={enableJson ? setMergedMenuState : null}
          onReorderMenuV2={enableJsonV2 ? setMergedMenuV2State : null}
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
            previewItems={activeFile.previewUrl ? [{ url: activeFile.previewUrl }] : []}
            onUpdateMenu={
              enableJson && activeFile.menu
                ? (updated) => onUpdateFileMenu(activeFile.id, updated)
                : null
            }
            onUpdateMenuV2={
              enableJsonV2 && activeFile.menuV2
                ? (updated) => onUpdateFileMenuV2(activeFile.id, updated)
                : null
            }
            onReorderMenu={
              enableJson && activeFile.menu
                ? (updated) => onUpdateFileMenu(activeFile.id, updated)
                : null
            }
            onReorderMenuV2={
              enableJsonV2 && activeFile.menuV2
                ? (updated) => onUpdateFileMenuV2(activeFile.id, updated)
                : null
            }
          />
        )
      )}
    </div>
  );
}
