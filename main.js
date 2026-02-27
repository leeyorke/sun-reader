/**
 * Sun Reader - Electron 主进程
 * 负责窗口管理、文件导入、书籍解析等功能
 */

const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');

// 应用配置
const APP_CONFIG = {
  name: 'Sun Reader',
  version: '1.0.0',
  booksDir: path.join(os.homedir(), 'SunReader', 'Books'),
  dataDir: path.join(os.homedir(), 'SunReader', 'Data'),
  settingsFile: path.join(os.homedir(), 'SunReader', 'settings.json'),
  dbFile: path.join(os.homedir(), 'SunReader', 'library.json')
};

// 保持全局窗口引用
let mainWindow = null;
let libraryData = {
  books: [],
  collections: [],
  readingHistory: [],
  bookmarks: [],
  notes: []
};

// ========================================
// 窗口管理
// ========================================

function createWindow() {
  // 加载设置
  const settings = loadSettings();

  mainWindow = new BrowserWindow({
    width: settings.windowSize?.width || 1400,
    height: settings.windowSize?.height || 900,
    minWidth: 900,
    minHeight: 600,
    title: APP_CONFIG.name,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: true
    },
    titleBarStyle: 'default',
    show: false // 先不显示，等加载完成再显示
  });

  // 加载应用首页
  mainWindow.loadFile('index.html');

  // 开发工具
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }

  // 窗口准备好后显示
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    // 如果有记住的位置
    if (settings.windowPosition &&
        settings.windowPosition.x !== undefined &&
        settings.windowPosition.y !== undefined) {
      mainWindow.setPosition(settings.windowPosition.x, settings.windowPosition.y);
    }
  });

  // 窗口关闭时保存位置和大小
  mainWindow.on('close', () => {
    const bounds = mainWindow.getBounds();
    const position = mainWindow.getPosition();
    saveSettings({
      ...loadSettings(),
      windowSize: { width: bounds.width, height: bounds.height },
      windowPosition: { x: position[0], y: position[1] }
    });
  });

  // 窗口关闭时清理引用
  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  // 设置应用菜单
  createApplicationMenu();
}

// ========================================
// 应用菜单
// ========================================

function createApplicationMenu() {
  const template = [
    {
      label: '文件',
      submenu: [
        {
          label: '导入书籍',
          accelerator: 'CmdOrCtrl+O',
          click: () => importBooks()
        },
        {
          label: '打开书籍文件夹',
          click: () => shell.openPath(APP_CONFIG.booksDir)
        },
        { type: 'separator' },
        {
          label: '退出',
          accelerator: process.platform === 'darwin' ? 'Cmd+Q' : 'Alt+F4',
          click: () => app.quit()
        }
      ]
    },
    {
      label: '查看',
      submenu: [
        { label: '刷新', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: '开发者工具', accelerator: 'F12', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '全屏', accelerator: 'F11', role: 'togglefullscreen' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 Sun Reader',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: '关于 Sun Reader',
              message: 'Sun Reader',
              detail: `版本: ${APP_CONFIG.version}\n\n一款简洁优雅的桌面端电子书阅读器。`
            });
          }
        }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

// ========================================
// 数据管理
// ========================================

function loadSettings() {
  try {
    if (fs.existsSync(APP_CONFIG.settingsFile)) {
      return JSON.parse(fs.readFileSync(APP_CONFIG.settingsFile, 'utf8'));
    }
  } catch (e) {
    console.error('加载设置失败:', e);
  }
  return {
    theme: 'light',
    fontSize: 21,
    recentBooks: []
  };
}

function saveSettings(settings) {
  try {
    fs.ensureDirSync(APP_CONFIG.dataDir);
    fs.writeFileSync(APP_CONFIG.settingsFile, JSON.stringify(settings, null, 2));
  } catch (e) {
    console.error('保存设置失败:', e);
  }
}

function loadLibrary() {
  try {
    if (fs.existsSync(APP_CONFIG.dbFile)) {
      libraryData = JSON.parse(fs.readFileSync(APP_CONFIG.dbFile, 'utf8'));
    } else {
      // 初始化数据库
      saveLibrary();
    }
  } catch (e) {
    console.error('加载书库失败:', e);
  }
}

function saveLibrary() {
  try {
    fs.ensureDirSync(APP_CONFIG.dataDir);
    fs.writeFileSync(APP_CONFIG.dbFile, JSON.stringify(libraryData, null, 2));
  } catch (e) {
    console.error('保存书库失败:', e);
  }
}

// ========================================
// 书籍导入功能
// ========================================

async function importBooks() {
  const result = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '电子书文件', extensions: ['epub', 'pdf', 'txt', 'mobi', 'azw3'] },
      { name: 'EPUB', extensions: ['epub'] },
      { name: 'PDF', extensions: ['pdf'] },
      { name: 'TXT', extensions: ['txt'] },
      { name: '所有文件', extensions: ['*'] }
    ],
    title: '导入书籍'
  });

  if (!result.canceled && result.filePaths.length > 0) {
    const importedBooks = [];

    for (const filePath of result.filePaths) {
      try {
        const bookInfo = await parseBook(filePath);
        if (bookInfo) {
          importedBooks.push(bookInfo);
        }
      } catch (e) {
        console.error('导入书籍失败:', filePath, e);
      }
    }

    // 添加到书库
    libraryData.books.push(...importedBooks);
    saveLibrary();

    // 通知渲染进程
    if (mainWindow) {
      mainWindow.webContents.send('books-imported', importedBooks);
    }

    // 显示导入成功提示
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: '导入完成',
      message: `成功导入 ${importedBooks.length} 本书籍`
    });
  }
}

/**
 * 解析书籍文件
 * @param {string} filePath
 * @returns {Promise<Object|null>}
 */
async function parseBook(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const fileName = path.basename(filePath, ext);
  const stats = await fs.stat(filePath);

  // 复制到书库目录
  const bookId = generateBookId();
  const bookDir = path.join(APP_CONFIG.booksDir, bookId);
  await fs.ensureDir(bookDir);

  const destPath = path.join(bookDir, `book${ext}`);
  await fs.copy(filePath, destPath);

  // 基础书籍信息
  const bookInfo = {
    id: bookId,
    title: fileName,
    author: '未知作者',
    format: ext.replace('.', '').toUpperCase(),
    filePath: destPath,
    cover: null,
    addedDate: new Date().toISOString(),
    lastRead: null,
    readingProgress: 0,
    totalPages: 0,
    fileSize: stats.size,
    description: '',
    tags: [],
    notes: [],
    bookmarks: []
  };

  // 根据格式尝试解析更多信息
  try {
    switch (ext) {
      case '.txt':
        await parseTXT(bookInfo, destPath);
        break;
    }
  } catch (e) {
    console.warn('解析书籍详情失败:', e);
  }

  return bookInfo;
}

/**
 * 生成书籍ID
 */
function generateBookId() {
  return 'book_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

/**
 * 解析 TXT 文件
 */
async function parseTXT(bookInfo, filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    // 尝试从第一行提取标题
    if (lines.length > 0 && lines[0].trim()) {
      const firstLine = lines[0].trim();
      if (firstLine.length < 100 && !firstLine.startsWith('第')) {
        bookInfo.title = firstLine;
      }
    }

    // 估算页数（假设每页1000字符）
    bookInfo.totalPages = Math.ceil(content.length / 1000);
  } catch (e) {
    console.warn('解析 TXT 失败:', e);
  }
}

// ========================================
// IPC 通信处理
// ========================================

// 获取所有书籍
ipcMain.handle('get-books', () => {
  return libraryData.books;
});

// 获取单本书籍详情
ipcMain.handle('get-book', (event, bookId) => {
  return libraryData.books.find(b => b.id === bookId);
});

// 删除书籍
ipcMain.handle('delete-book', async (event, bookId) => {
  const index = libraryData.books.findIndex(b => b.id === bookId);
  if (index > -1) {
    const book = libraryData.books[index];

    // 删除书籍文件
    try {
      const bookDir = path.join(APP_CONFIG.booksDir, bookId);
      await fs.remove(bookDir);
    } catch (e) {
      console.error('删除书籍文件失败:', e);
    }

    // 从数据库移除
    libraryData.books.splice(index, 1);
    saveLibrary();

    return { success: true };
  }
  return { success: false, error: '书籍不存在' };
});

// 更新阅读进度
ipcMain.handle('update-progress', (event, { bookId, progress, currentPage }) => {
  const book = libraryData.books.find(b => b.id === bookId);
  if (book) {
    book.readingProgress = progress;
    book.currentPage = currentPage;
    book.lastRead = new Date().toISOString();
    saveLibrary();
    return { success: true };
  }
  return { success: false, error: '书籍不存在' };
});

// 导入书籍
ipcMain.handle('import-books', async () => {
  await importBooks();
  return libraryData.books;
});

// 获取应用配置
ipcMain.handle('get-config', () => {
  return {
    booksDir: APP_CONFIG.booksDir,
    dataDir: APP_CONFIG.dataDir,
    version: APP_CONFIG.version
  };
});

// 打开文件对话框
ipcMain.handle('show-open-dialog', async (event, options) => {
  const result = await dialog.showOpenDialog(mainWindow, options);
  return result;
});

// 打开外部链接
ipcMain.handle('open-external', async (event, url) => {
  await shell.openExternal(url);
});

// 获取书籍文件路径
ipcMain.handle('get-book-path', (event, bookId) => {
  const book = libraryData.books.find(b => b.id === bookId);
  if (book) {
    return book.filePath;
  }
  return null;
});

// 读取书籍内容
ipcMain.handle('read-book-content', async (event, bookId) => {
  const book = libraryData.books.find(b => b.id === bookId);
  if (!book) {
    return { success: false, error: '书籍不存在' };
  }

  try {
    const fs = require('fs');
    const content = fs.readFileSync(book.filePath, 'utf8');
    return {
      success: true,
      content,
      format: book.format.toLowerCase()
    };
  } catch (e) {
    return { success: false, error: '读取失败: ' + e.message };
  }
});

// ========================================
// 应用生命周期
// ========================================

// 确保单实例运行
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  console.log('应用已在运行，退出新实例');
  app.quit();
} else {
  app.on('second-instance', (event, commandLine, workingDirectory) => {
    // 当运行第二个实例时，聚焦到第一个实例的窗口
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // 初始化应用
  app.whenReady().then(async () => {
    // 确保目录存在
    await fs.ensureDir(APP_CONFIG.booksDir);
    await fs.ensureDir(APP_CONFIG.dataDir);

    // 加载书库数据
    loadLibrary();

    // 创建主窗口
    createWindow();

    console.log('Sun Reader 已启动');
  });

  // 当所有窗口关闭时退出应用
  app.on('window-all-closed', () => {
    // macOS 上通常应用在窗口关闭后仍保持运行
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });

  // 当应用被激活时（macOS）
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });

  // 退出前清理
  app.on('before-quit', () => {
    saveLibrary();
  });
}

// 处理未捕获的异常
process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的 Promise 拒绝:', reason);
});
