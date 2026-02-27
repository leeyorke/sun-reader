/**
 * Sun Reader - TypeScript 类型定义
 */

// ========================================
// 书籍相关类型
// ========================================

export type BookFormat = 'EPUB' | 'PDF' | 'TXT' | 'MOBI' | 'AZW3';

export interface Book {
  id: string;
  title: string;
  author: string;
  format: BookFormat;
  filePath: string;
  cover: string | null;
  addedDate: string;
  lastRead: string | null;
  readingProgress: number;
  currentPage: number;
  totalPages: number;
  fileSize: number;
  description: string;
  tags: string[];
  notes: Note[];
  bookmarks: Bookmark[];
}

export interface Note {
  id: string;
  bookId: string;
  content: string;
  quote: string;
  position: number;
  color: string;
  createdAt: string;
  updatedAt: string;
}

export interface Bookmark {
  id: string;
  bookId: string;
  position: number;
  chapter?: string;
  createdAt: string;
}

// ========================================
// 设置相关类型
// ========================================

export type Theme = 'light' | 'dark' | 'sepia';

export interface ReaderSettings {
  theme: Theme;
  fontSize: number;
  fontFamily: string;
  lineHeight: number;
  pageMargins: number;
}

export interface AppSettings {
  windowSize: { width: number; height: number };
  windowPosition: { x: number; y: number };
  reader: ReaderSettings;
}

// ========================================
// 阅读进度类型
// ========================================

export interface ReadingProgress {
  bookId: string;
  progress: number;
  currentPage: number;
  chapter?: string;
  timestamp: string;
}

// ========================================
// 搜索相关类型
// ========================================

export interface SearchMatch {
  position: number;
  text: string;
  highlightedText: string;
}

export interface SearchResult {
  bookId: string;
  bookTitle: string;
  matches: SearchMatch[];
}

// ========================================
// 目录相关类型
// ========================================

export interface TocItem {
  title: string;
  position: number;
  level: number;
  children?: TocItem[];
}

// ========================================
// 视图模式类型
// ========================================

export type ViewMode = 'standard' | 'immersive' | 'dual';

// ========================================
// Electron API 类型
// ========================================

export interface ElectronAPI {
  app: {
    getConfig: () => Promise<{ booksDir: string; dataDir: string; version: string }>;
    openExternal: (url: string) => Promise<void>;
  };
  books: {
    getAll: () => Promise<Book[]>;
    get: (bookId: string) => Promise<Book | undefined>;
    import: () => Promise<Book[]>;
    delete: (bookId: string) => Promise<{ success: boolean; error?: string }>;
    getPath: (bookId: string) => Promise<string | null>;
    readContent: (bookId: string) => Promise<{ success: boolean; content?: string; format?: string; error?: string }>;
    updateProgress: (bookId: string, progress: number, currentPage: number) => Promise<{ success: boolean }>;
  };
  dialog: {
    showOpen: (options: Electron.OpenDialogOptions) => Promise<Electron.OpenDialogReturnValue>;
  };
  on: (channel: 'books-imported', callback: (books: Book[]) => void) => void;
  off: (channel: string, callback: (...args: any[]) => void) => void;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}

// ========================================
// 通用工具类型
// ========================================

export type Nullable<T> = T | null;
export type Optional<T> = T | undefined;

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}
