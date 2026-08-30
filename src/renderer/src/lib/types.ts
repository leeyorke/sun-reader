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
  /** 正文锚点（data-anchor 索引 + 元素内比例位置），改字号/重开时精确恢复位置 */
  readingAnchor?: ReadingAnchor;
}

/**
 * 正文位置锚点：index = TXT 段落索引 / EPUB 章节索引；
 * offset = 窗口起点在该元素内的列位置**比例** [0,1)，语义与实现见
 * `hooks/useColumnPagination.ts` 的 ReadingAnchor 注释。
 */
export interface ReadingAnchor {
  index: number;
  offset: number;
}

export interface Note {
  id: string;
  bookId: string;
  content: string;
  quote: string;
  /** 保存时的阅读进度百分比（跳转兜底用） */
  position: number;
  color: string;
  /** 'underline' = 纯划线；'note' = 带想法的批注（旧数据缺省视为 'note'） */
  type?: 'note' | 'underline';
  /** 划线定位（TXT）：全局段落索引 + 段内字符区间 [start, end) */
  pidx?: number;
  /** 划线定位（EPUB 原书渲染）：章节索引 + 整章纯文本上的字符区间 [start, end) */
  chidx?: number;
  start?: number;
  end?: number;
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

export type Theme = 'light' | 'dark';

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
// 阅读内容块（分页正文的最小单元）
// ========================================

export type ReaderBlockKind = 'title' | 'heading' | 'para' | 'pre';

export interface ReaderBlock {
  kind: ReaderBlockKind;
  text: string;
  /** heading 块的标题级别（2-6，对应 h2-h6） */
  level?: number;
  /** 段落/小标题/代码块的全局索引（title 块无；划线/跳转/搜索都以此为锚点） */
  pidx?: number;
}

// ========================================
// Electron API 类型
// ========================================

// ========================================
// Electron 对话框类型（渲染进程不含 electron 类型，这里给最小声明）
// ========================================

export interface OpenDialogOptions {
  title?: string;
  properties?: Array<'openFile' | 'multiSelections' | 'openDirectory' | 'createDirectory'>;
  filters?: Array<{ name: string; extensions: string[] }>;
}

export interface OpenDialogReturnValue {
  canceled: boolean;
  filePaths: string[];
}

export interface ElectronAPI {
  app: {
    getConfig: () => Promise<{ booksDir: string; coversDir: string; version: string }>;
    openExternal: (url: string) => Promise<void>;
  };
  books: {
    getAll: () => Promise<Book[]>;
    get: (bookId: string) => Promise<Book | undefined>;
    import: () => Promise<Book[]>;
    delete: (bookId: string) => Promise<{ success: boolean; error?: string }>;
    getPath: (bookId: string) => Promise<string | null>;
    readContent: (bookId: string) => Promise<{
      success: boolean;
      content?: string;
      format?: string;
      error?: string;
      meta?: { title: string; creator: string };
      chapters?: Array<{
        title: string;
        /** EPUB：相对 OPF 目录的 spine 路径（书内链接解析基准） */
        href?: string;
        /** EPUB：spine 原始 XHTML（渲染端净化后配合原书 CSS 渲染） */
        xhtml?: string;
      }>;
    }>;
    updateProgress: (
      bookId: string,
      progress: number,
      currentPage: number,
      anchor?: { index: number; offset: number },
      /** 渲染层实测总页数（一列 = 一页），覆盖导入时按字数的估算 */
      totalPages?: number
    ) => Promise<{ success: boolean }>;
  };
  dialog: {
    showOpen: (options: OpenDialogOptions) => Promise<OpenDialogReturnValue>;
  };
  system: {
    /** 主进程枚举系统字体（Windows 读字体文件 name 表 / Linux fc-list / macOS 字体目录） */
    listFonts: () => Promise<{
      success: boolean;
      fonts: string[];
      /** 别名组：键 = 组内首个名字，值 = 同一字体文件的其余家族名（如中英文双名） */
      aliases?: Record<string, string[]>;
      error?: string;
    }>;
  };
  bookmarks: {
    add: (payload: { bookId: string; position: number; chapter?: string }) => Promise<{ success: boolean; bookmark?: Bookmark; error?: string }>;
    remove: (payload: { bookId: string; bookmarkId: string }) => Promise<{ success: boolean; error?: string }>;
  };
  covers: {
    get: (bookId: string) => Promise<{ success: boolean; dataUrl?: string; error?: string }>;
  };
  notes: {
    add: (payload: { bookId: string; note: Partial<Note> }) => Promise<{ success: boolean; note?: Note; error?: string }>;
    update: (payload: { bookId: string; noteId: string; patch: Partial<Pick<Note, 'content' | 'color'>> }) => Promise<{ success: boolean; note?: Note; error?: string }>;
    remove: (payload: { bookId: string; noteId: string }) => Promise<{ success: boolean; error?: string }>;
  };
  on: (channel: 'books-imported', callback: (books: Book[]) => void) => void;
  off: (channel: string, callback: (...args: any[]) => void) => void;
}

// ========================================
// 本地字体访问（Chromium Local Font Access API）
// ========================================

export interface FontData {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
}

declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
  interface Navigator {
    /** Electron(Chromium) 下可用；未授权/不可用时为 undefined */
    queryLocalFonts?: () => Promise<FontData[]>;
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
