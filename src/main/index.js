/**
 * Sun Reader - Electron 主进程
 * 负责窗口管理、文件导入、书籍解析等功能
 */

const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');

// 应用配置（用户数据统一存放在用户主目录的隐藏目录 ~/.sunreader）
// 版本号唯一来源是 package.json，这里动态读取，避免多处硬编码漂移
const APP_CONFIG = {
  name: 'Sun Reader',
  version: require('../../package.json').version,
  rootDir: path.join(os.homedir(), '.sunreader'),
  booksDir: path.join(os.homedir(), '.sunreader', 'Books'),
  coversDir: path.join(os.homedir(), '.sunreader', 'Covers'),
  settingsFile: path.join(os.homedir(), '.sunreader', 'settings.json'),
  dbFile: path.join(os.homedir(), '.sunreader', 'library.json')
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

/**
 * 加载 Vite 开发服务器，带自动重试。
 * concurrently 同时启动 vite 与 electron，electron 可能先于服务器就绪，
 * 首次 loadURL 会触发 did-fail-load，这里每 300ms 重试直到成功。
 */
function loadDevServerUrl(url, maxRetries = 60) {
  let attempts = 0;
  const tryLoad = () => {
    attempts++;
    // 失败时由下方 did-fail-load 监听器处理重试，这里吞掉 Promise 拒绝
    mainWindow.loadURL(url).catch(() => {});
  };

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, _desc, _url, isMainFrame) => {
    // -3 = ERR_ABORTED：重复导航/手动刷新引起，忽略
    if (!isMainFrame || errorCode === -3) return;
    if (attempts < maxRetries) {
      setTimeout(tryLoad, 300);
    } else {
      console.error(`[Sun Reader] 无法连接开发服务器 ${url}，请确认 vite 已启动（pnpm run dev:vite）`);
    }
  });

  tryLoad();
}

function createWindow() {
  // 加载设置
  const settings = loadSettings();

  mainWindow = new BrowserWindow({
    width: settings.windowSize?.width || 1400,
    height: settings.windowSize?.height || 900,
    minWidth: 900,
    minHeight: 600,
    title: APP_CONFIG.name,
    icon: path.join(__dirname, '../../build', 'icon.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '../preload', 'index.js'),
      webSecurity: true
    },
    titleBarStyle: 'default',
    show: false // 先不显示，等加载完成再显示
  });

  // 加载应用首页：--dev 连 Vite 开发服务器，否则加载打包产物
  const isDev = process.argv.includes('--dev');
  if (isDev) {
    loadDevServerUrl('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist', 'index.html'));
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

  // 不使用任何原生菜单栏
  Menu.setApplicationMenu(null);

  // 开发模式下保留常用快捷键（F12 开发者工具 / F11 全屏 / Ctrl+R 刷新），不依赖菜单
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (input.key === 'F12') {
        mainWindow.webContents.toggleDevTools();
        event.preventDefault();
      } else if (input.key === 'F11') {
        mainWindow.setFullScreen(!mainWindow.isFullScreen());
        event.preventDefault();
      } else if (input.ctrlKey && input.key.toLowerCase() === 'r') {
        mainWindow.webContents.reload();
        event.preventDefault();
      }
    });
  }
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
    fs.ensureDirSync(APP_CONFIG.rootDir);
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
    fs.ensureDirSync(APP_CONFIG.rootDir);
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

    // 通知渲染进程（渲染进程据此刷新书库并提示）
    if (mainWindow) {
      mainWindow.webContents.send('books-imported', importedBooks);
    }
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
      case '.epub':
        await parseEpubMeta(bookInfo, destPath);
        break;
    }
  } catch (e) {
    console.warn('解析书籍详情失败:', e);
  }

  return bookInfo;
}

/**
 * 从 EPUB 元数据补充标题、作者，并按字数估算总页数
 */
async function parseEpubMeta(bookInfo, filePath) {
  try {
    const { parseEpub, extractCover } = require('./epub-parser');
    const result = parseEpub(filePath);
    if (result.ok) {
      if (result.meta.title) bookInfo.title = result.meta.title;
      if (result.meta.creator) bookInfo.author = result.meta.creator;
      const totalChars = result.chapters.reduce(
        (sum, c) => sum + c.paragraphs.join('').length,
        0
      );
      bookInfo.totalPages = Math.max(1, Math.ceil(totalChars / 1000));
    }

    // 封面抽取 → 缓存 Covers/{bookId}.ext，书库直接展示
    const cover = extractCover(filePath);
    if (cover.ok) {
      await fs.ensureDir(APP_CONFIG.coversDir);
      const fileName = `${bookInfo.id}${cover.extension}`;
      await fs.writeFile(path.join(APP_CONFIG.coversDir, fileName), cover.data);
      bookInfo.cover = fileName;
    }
  } catch (e) {
    console.warn('解析 EPUB 元数据失败:', e);
  }
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
      // 清理封面缓存
      if (await fs.pathExists(APP_CONFIG.coversDir)) {
        const files = await fs.readdir(APP_CONFIG.coversDir);
        await Promise.all(
          files
            .filter((f) => f.startsWith(`${bookId}.`))
            .map((f) => fs.remove(path.join(APP_CONFIG.coversDir, f)))
        );
      }
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
    coversDir: APP_CONFIG.coversDir,
    version: APP_CONFIG.version
  };
});

// 获取书籍封面（返回 data URL；无缓存时对 EPUB 惰性抽取并缓存）
ipcMain.handle('get-book-cover', async (event, bookId) => {
  const book = libraryData.books.find((b) => b.id === bookId);
  if (!book) return { success: false, error: '书籍不存在' };

  try {
    await fs.ensureDir(APP_CONFIG.coversDir);
    let file = null;
    const cached = (await fs.readdir(APP_CONFIG.coversDir)).find((f) =>
      f.startsWith(`${bookId}.`)
    );
    if (cached) {
      file = path.join(APP_CONFIG.coversDir, cached);
    } else if (book.format === 'EPUB' && book.filePath && (await fs.pathExists(book.filePath))) {
      // 旧数据没有封面缓存：现场抽取补上
      const { extractCover } = require('./epub-parser');
      const cover = extractCover(book.filePath);
      if (cover.ok) {
        file = path.join(APP_CONFIG.coversDir, `${bookId}${cover.extension}`);
        await fs.writeFile(file, cover.data);
        // 回填 library.json，下次直接命中
        book.cover = path.basename(file);
        saveLibrary();
      }
    }

    if (!file || !(await fs.pathExists(file))) return { success: false };

    const ext = path.extname(file).slice(1).toLowerCase();
    const mime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
    const data = await fs.readFile(file);
    return { success: true, dataUrl: `data:${mime};base64,${data.toString('base64')}` };
  } catch (e) {
    console.error('获取封面失败:', e);
    return { success: false, error: e.message };
  }
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

// 读取书籍内容（按格式分发：TXT 纯文本 / EPUB 结构化章节）
ipcMain.handle('read-book-content', async (event, bookId) => {
  const book = libraryData.books.find(b => b.id === bookId);
  if (!book) {
    return { success: false, error: '书籍不存在' };
  }

  try {
    if (book.format === 'EPUB') {
      const { parseEpub } = require('./epub-parser');
      const result = parseEpub(book.filePath);
      if (!result.ok) {
        return { success: false, error: result.error };
      }
      return {
        success: true,
        format: 'epub',
        meta: result.meta,
        chapters: result.chapters
      };
    }

    // 其余格式按纯文本读取（TXT 正常阅读；PDF/MOBI/AZW3 会返回乱码，渲染端已拦截提示）
    const fs = require('fs');
    const content = fs.readFileSync(book.filePath, 'utf8');
    return { success: true, content, format: book.format.toLowerCase() };
  } catch (e) {
    return { success: false, error: '读取失败: ' + e.message };
  }
});

// 添加书签
ipcMain.handle('add-bookmark', (event, { bookId, position, chapter }) => {
  const book = libraryData.books.find(b => b.id === bookId);
  if (!book) return { success: false, error: '书籍不存在' };
  const bookmark = {
    id: `bm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    bookId,
    position,
    chapter: chapter || '',
    createdAt: new Date().toISOString()
  };
  book.bookmarks.push(bookmark);
  saveLibrary();
  return { success: true, bookmark };
});

// 删除书签
ipcMain.handle('remove-bookmark', (event, { bookId, bookmarkId }) => {
  const book = libraryData.books.find(b => b.id === bookId);
  if (!book) return { success: false, error: '书籍不存在' };
  book.bookmarks = book.bookmarks.filter(b => b.id !== bookmarkId);
  saveLibrary();
  return { success: true };
});

// 添加批注
ipcMain.handle('add-note', (event, { bookId, note }) => {
  const book = libraryData.books.find(b => b.id === bookId);
  if (!book) return { success: false, error: '书籍不存在' };
  const now = new Date().toISOString();
  const fullNote = {
    id: `note_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    bookId,
    content: note.content || '',
    quote: note.quote || '',
    position: note.position || 0,
    color: note.color || '#F2542D',
    createdAt: now,
    updatedAt: now
  };
  book.notes.push(fullNote);
  saveLibrary();
  return { success: true, note: fullNote };
});

// 删除批注
ipcMain.handle('remove-note', (event, { bookId, noteId }) => {
  const book = libraryData.books.find(b => b.id === bookId);
  if (!book) return { success: false, error: '书籍不存在' };
  book.notes = book.notes.filter(n => n.id !== noteId);
  saveLibrary();
  return { success: true };
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
    await fs.ensureDir(APP_CONFIG.coversDir);

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
