/**
 * Sun Reader - Electron API 封装
 */

import type { Book, ElectronAPI } from '@/lib/types';

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
};

// 对话框 API
export const dialogApi = {
  showOpen: (options: Electron.OpenDialogOptions) =>
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
