/**
 * Sun Reader - 常量定义
 */

import type { ReaderSettings, Theme } from './types';

// ========================================
// 应用信息
// ========================================

export const APP_NAME = 'Sun Reader';

// ========================================
// 主题
// ========================================

export const THEMES: Theme[] = ['light', 'dark', 'sepia'];

export const THEME_LABELS: Record<Theme, string> = {
  light: '浅色',
  dark: '深色',
  sepia: ' Sepia',
};

// ========================================
// 字体设置
// ========================================

export const MIN_FONT_SIZE = 14;
export const MAX_FONT_SIZE = 32;
export const DEFAULT_FONT_SIZE = 18;
export const FONT_SIZE_STEP = 2;

export const FONT_FAMILIES = [
  { value: 'serif', label: '衬线体', family: 'Noto Serif SC, Source Serif 4, Georgia, serif' },
  { value: 'sans', label: '无衬线', family: 'Inter, PingFang SC, -apple-system, sans-serif' },
  { value: 'mono', label: '等宽', family: 'JetBrains Mono, Fira Code, monospace' },
];

// ========================================
// 行高和边距
// ========================================

export const LINE_HEIGHT_OPTIONS = [
  { value: 1.5, label: '紧凑' },
  { value: 1.75, label: '舒适' },
  { value: 2.0, label: '宽松' },
];

export const PAGE_MARGIN_OPTIONS = [
  { value: 16, label: '窄' },
  { value: 24, label: '中' },
  { value: 32, label: '宽' },
];

// ========================================
// 默认设置
// ========================================

export const DEFAULT_READER_SETTINGS: ReaderSettings = {
  theme: 'light',
  fontSize: DEFAULT_FONT_SIZE,
  fontFamily: 'serif',
  lineHeight: 1.75,
  pageMargins: 24,
};

// ========================================
// 存储键名
// ========================================

export const STORAGE_KEYS = {
  SETTINGS: 'sun-reader-settings',
  LIBRARY: 'sun-reader-library',
  READING_PROGRESS: 'sun-reader-progress',
  THEME: 'sun-reader-theme',
  FONT_SIZE: 'sun-reader-font-size',
} as const;

// ========================================
// IPC 通道
// ========================================

export const IPC_CHANNELS = {
  GET_BOOKS: 'get-books',
  GET_BOOK: 'get-book',
  IMPORT_BOOKS: 'import-books',
  DELETE_BOOK: 'delete-book',
  UPDATE_PROGRESS: 'update-progress',
  READ_BOOK_CONTENT: 'read-book-content',
  GET_BOOK_PATH: 'get-book-path',
  GET_CONFIG: 'get-config',
  OPEN_EXTERNAL: 'open-external',
  SHOW_OPEN_DIALOG: 'show-open-dialog',
  BOOKS_IMPORTED: 'books-imported',
} as const;

// ========================================
// 文件格式
// ========================================

export const SUPPORTED_FORMATS = ['epub', 'pdf', 'txt', 'mobi', 'azw3'] as const;

export const FORMAT_LABELS: Record<string, string> = {
  epub: 'EPUB',
  pdf: 'PDF',
  txt: 'TXT',
  mobi: 'MOBI',
  azw3: 'AZW3',
};

// ========================================
// 分页和滚动
// ========================================

export const SCROLL_DEBOUNCE = 100;
export const PROGRESS_SAVE_INTERVAL = 5000;
export const SEARCH_DEBOUNCE = 300;

// ========================================
// 批注颜色
// ========================================

export const ANNOTATION_COLORS = [
  { value: '#F2542D', label: '红色' },
  { value: '#4A90D9', label: '蓝色' },
  { value: '#7CB342', label: '绿色' },
  { value: '#F5A623', label: '黄色' },
  { value: '#BD10E0', label: '紫色' },
] as const;

// ========================================
// 视图模式
// ========================================

export const VIEW_MODES = [
  { value: 'standard', label: '标准', icon: 'Layout' },
  { value: 'immersive', label: '沉浸', icon: 'Maximize' },
  { value: 'dual', label: '双页', icon: 'BookOpen' },
] as const;
