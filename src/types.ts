// ─── V1 Types ─────────────────────────────────────────────────────────────────
export interface MenuEntry {
  title: string;
  price: string | null;
  description: string | null;
}

export interface MenuCategory {
  title: string;
  entries: MenuEntry[];
}

export type MenuData = MenuCategory[];

// ─── V2 Types ─────────────────────────────────────────────────────────────────
export interface MenuItemV2 {
  uuid: null;
  key: null;
  position: number;
  title: string;
  description: string | null;
  price: number | null;
}

export interface MenuCategoryV2 {
  uuid: null;
  key: null;
  name: string;
  position: number;
  menuItems: MenuItemV2[];
}

export type MenuDataV2 = MenuCategoryV2[];

// ─── App Types ────────────────────────────────────────────────────────────────
export type FileItemStatus = 'pending' | 'processing' | 'success' | 'error';

export interface FileItem {
  id: string;
  file: File;
  fileName: string;
  status: FileItemStatus;
  menu: MenuData | null;
  menuV2: MenuDataV2 | null;
  /** Data URL of the processed image — JPEG for PDFs, original mime for images. Null until extraction succeeds. */
  previewUrl: string | null;
  error: string | null;
}

export type AppStatus = 'idle' | 'ready' | 'processing' | 'done';

export interface AppState {
  status: AppStatus;
  files: FileItem[];
}
