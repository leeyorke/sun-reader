/**
 * Sun Reader - Electron API 封装
 */

import type { Book, ElectronAPI, OpenDialogOptions, Theme } from '@/lib/types';

// 直接访问 window.electronAPI
export const electronApi: ElectronAPI = window.electronAPI;

// 书籍 API 封装
export const booksApi = {
  getAll: () => electronApi.books.getAll(),

  get: (bookId: string) => electronApi.books.get(bookId),

  import: () => electronApi.books.import(),

  delete: (bookId: string) => electronApi.books.delete(bookId),

  getPath: (bookId: string) => electronApi.books.getPath(bookId),

  readContent: (bookId: string) => electronApi.books.readContent(bookId),

  updateProgress: (bookId: string, progress: number, currentPage: number) =>
    electronApi.books.updateProgress(bookId, progress, currentPage),
};

// 应用配置 API
export const appApi = {
  getConfig: () => electronApi.app.getConfig(),
  openExternal: (url: string) => electronApi.app.openExternal(url),
  setNativeTheme: (theme: Theme, backgroundColor: string) =>
    electronApi.app.setNativeTheme(theme, backgroundColor),
  windowControl: (action: 'minimize' | 'toggle-maximize' | 'close') =>
    electronApi.app.windowControl(action),
};

/** 运行平台（浏览器里为空串） */
export const appPlatform = (): string =>
  typeof window !== 'undefined' ? window.electronAPI?.app?.platform ?? '' : '';

/**
 * 是否为自定义标题栏（主进程 titleBarStyle:'hidden'）：Windows/macOS 隐藏原生标题栏，
 * caption 区透明、露出页面背景，需要渲染层自己画一条顶部拖拽区；Linux 保留原生边框。
 * 浏览器里（无 preload）恒为 false。
 */
export const hasCustomCaption = (): boolean => {
  const p = appPlatform();
  return p !== '' && p !== 'linux';
};

/**
 * 是否需要自己画窗口按钮（最小化/最大化/关闭）：只有 Windows。
 * titleBarStyle:'hidden' 会连 WS_SYSMENU 一起去掉，原生三键不会画；macOS 的红绿灯
 * 由系统保留，Linux 用原生边框。
 */
export const needsCustomWindowControls = (): boolean => appPlatform() === 'win32';

// 对话框 API
export const dialogApi = {
  showOpen: (options: OpenDialogOptions) =>
    electronApi.dialog.showOpen(options),
};

// 事件监听
export const setupEventListeners = (callbacks: {
  onBooksImported?: (books: Book[]) => void;
}) => {
  if (callbacks.onBooksImported) {
    electronApi.on('books-imported', callbacks.onBooksImported);
  }

  // 返回清理函数
  return () => {
    if (callbacks.onBooksImported) {
      electronApi.off('books-imported', callbacks.onBooksImported);
    }
  };
};
