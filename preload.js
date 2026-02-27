/**
 * Sun Reader - Electron 预加载脚本
 * 提供安全的 IPC 通信桥接
 */

const { contextBridge, ipcRenderer } = require('electron');

// API 暴露给渲染进程
contextBridge.exposeInMainWorld('electronAPI', {
  // 应用信息
  app: {
    getConfig: () => ipcRenderer.invoke('get-config'),
    openExternal: (url) => ipcRenderer.invoke('open-external', url)
  },

  // 书籍管理
  books: {
    // 获取所有书籍
    getAll: () => ipcRenderer.invoke('get-books'),

    // 获取单本书籍
    get: (bookId) => ipcRenderer.invoke('get-book', bookId),

    // 导入书籍
    import: () => ipcRenderer.invoke('import-books'),

    // 删除书籍
    delete: (bookId) => ipcRenderer.invoke('delete-book', bookId),

    // 获取书籍文件路径
    getPath: (bookId) => ipcRenderer.invoke('get-book-path', bookId),

    // 读取书籍内容
    readContent: (bookId) => ipcRenderer.invoke('read-book-content', bookId),

    // 更新阅读进度
    updateProgress: (bookId, progress, currentPage) =>
      ipcRenderer.invoke('update-progress', { bookId, progress, currentPage })
  },

  // 对话框
  dialog: {
    showOpen: (options) => ipcRenderer.invoke('show-open-dialog', options)
  },

  // 事件监听
  on: (channel, callback) => {
    // 只允许特定的通道
    const validChannels = ['books-imported'];
    if (validChannels.includes(channel)) {
      ipcRenderer.on(channel, (event, ...args) => callback(...args));
    }
  },

  // 移除事件监听
  off: (channel, callback) => {
    ipcRenderer.removeListener(channel, callback);
  }
});

// 页面加载完成后，通知主进程
window.addEventListener('DOMContentLoaded', () => {
  console.log('Sun Reader 渲染进程已加载');
});
