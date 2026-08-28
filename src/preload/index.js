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

    // 更新阅读进度（anchor 为正文锚点：改字号/重开后精确恢复位置；
    // totalPages 为渲染层实测总页数，覆盖导入时按字数的估算）
    updateProgress: (bookId, progress, currentPage, anchor, totalPages) =>
      ipcRenderer.invoke('update-progress', { bookId, progress, currentPage, anchor, totalPages })
  },

  // 对话框
  dialog: {
    showOpen: (options) => ipcRenderer.invoke('show-open-dialog', options)
  },

  // 系统（字体枚举等）
  system: {
    listFonts: () => ipcRenderer.invoke('list-system-fonts')
  },

  // 书签
  bookmarks: {
    add: (payload) => ipcRenderer.invoke('add-bookmark', payload),
    remove: (payload) => ipcRenderer.invoke('remove-bookmark', payload)
  },

  // 封面
  covers: {
    get: (bookId) => ipcRenderer.invoke('get-book-cover', bookId)
  },

  // 批注
  notes: {
    add: (payload) => ipcRenderer.invoke('add-note', payload),
    update: (payload) => ipcRenderer.invoke('update-note', payload),
    remove: (payload) => ipcRenderer.invoke('remove-note', payload)
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
