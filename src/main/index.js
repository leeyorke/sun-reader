/**
 * Sun Reader - Electron 主进程
 * 负责窗口管理、文件导入、书籍解析等功能
 */

const { app, BrowserWindow, dialog, ipcMain, Menu, protocol, shell } = require('electron');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');

// bookres 自定义协议：向渲染层提供 EPUB 包内资源（XHTML/CSS/图片/字体）。
// standard+secure+supportFetchAPI 必须在 app ready 前注册。
protocol.registerSchemesAsPrivileged([
  { scheme: 'bookres', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

/** bookres 响应的 Content-Type 映射（刻意不服务 js，正文渲染不需要也不安全） */
const BOOKRES_MIME = {
  xhtml: 'application/xhtml+xml', html: 'text/html', htm: 'text/html', xml: 'application/xml',
  css: 'text/css', opf: 'application/oebps-package+xml', ncx: 'application/x-dtbncx+xml',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
  svg: 'image/svg+xml', ttf: 'font/ttf', otf: 'font/otf', woff: 'font/woff', woff2: 'font/woff2',
  mp3: 'audio/mpeg', mp4: 'video/mp4', ogg: 'audio/ogg',
};

function handleBookResRequest(request) {
  try {
    const url = new URL(request.url);
    const bookId = url.hostname;
    // standard scheme 会把剩余路径放进 pathname；书内路径可能含中文，需解码
    const relPath = decodeURIComponent(url.pathname.replace(/^\//, ''));
    const book = libraryData.books.find((b) => b.id === bookId);
    if (!book || book.format !== 'EPUB' || !book.filePath) {
      return new Response('not found', { status: 404 });
    }
    const { readEpubResource } = require('./epub-parser');
    const data = readEpubResource(book.filePath, relPath);
    if (!data) return new Response('not found', { status: 404 });
    const ext = (relPath.split('.').pop() || '').toLowerCase();
    return new Response(data, {
      headers: { 'content-type': BOOKRES_MIME[ext] || 'application/octet-stream' },
    });
  } catch (e) {
    console.error('bookres 协议错误:', request.url, e);
    return new Response('error', { status: 500 });
  }
}

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

    // 释放 EPUB 资源协议的 zip 缓存，避免文件句柄滞留
    if (book.format === 'EPUB') {
      try { require('./epub-parser').dropEpubCache(book.filePath); } catch { /* 忽略 */ }
    }

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

// 更新阅读进度（anchor = { index, offset } 正文锚点，打开/重排时精确恢复位置；
// totalPages = 渲染层实测总页数，覆盖导入时按字数的估算，使书库与阅读页页数一致）
ipcMain.handle('update-progress', (event, { bookId, progress, currentPage, anchor, totalPages }) => {
  const book = libraryData.books.find(b => b.id === bookId);
  if (book) {
    book.readingProgress = progress;
    book.currentPage = currentPage;
    book.lastRead = new Date().toISOString();
    if (Number.isFinite(totalPages) && totalPages > 0) {
      book.totalPages = Math.round(totalPages);
    }
    if (anchor && Number.isInteger(anchor.index) && anchor.index >= 0) {
      book.readingAnchor = { index: anchor.index, offset: Number(anchor.offset) || 0 };
    }
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

// ========================================
// 系统字体枚举（设置页字体选择器）
// Electron 渲染层默认不暴露 Chromium 的 queryLocalFonts API，
// 这里在主进程按平台枚举：Windows 读注册表 / Linux 用 fc-list / macOS 扫描字体目录
// ========================================

const { execFileSync } = require('child_process');
const fsSync = require('fs');
let systemFontsCache = null;

let cliDecoder = null;
/** reg 等 Windows CLI 的重定向输出使用系统 OEM 代码页（中文系统 GBK/cp936），
 * 按 UTF-8 解码会让中文字体名变乱码；这里探测代码页后用对应 TextDecoder 解码 */
function getCliTextDecoder() {
  if (cliDecoder) return cliDecoder;
  try {
    const out = execFileSync('cmd', ['/d', '/c', 'chcp'], { encoding: 'utf8', windowsHide: true });
    const num = Number((out.match(/(\d+)/) || [])[1] || 65001);
    const label = { 936: 'gbk', 950: 'big5', 932: 'shift_jis', 949: 'euc-kr', 850: 'ibm850', 1252: 'windows-1252' }[num] || 'utf-8';
    cliDecoder = new TextDecoder(label);
  } catch {
    cliDecoder = new TextDecoder('utf-8');
  }
  return cliDecoder;
}

// 尾部风格变体：空格/连字符/下划线 + 风格词（可叠加，如 "Bold Italic"）
const FONT_STYLE_SUFFIX_RE =
  /(?:^|[\s_-])(?:Bold|Italic|Oblique|Light|Medium|Thin|Black|Heavy|Regular|SemiBold|Semibold|Semilight|DemiBold|ExtraBold|ExtraLight|Condensed)+$/i;

/** "Microsoft YaHei & Microsoft YaHei UI (TrueType)" → ["Microsoft YaHei", "Microsoft YaHei UI"] */
function splitWindowsFontValueName(name) {
  const withoutType = name
    .replace(/\s*\((?:TrueType|OpenType|PostScript|Bitmap|Raster|Vector|TrueTypeArc)[^)]*\)\s*$/i, '')
    .trim();
  return withoutType
    .split('&')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 收敛风格变体："Arial Bold Italic" → "Arial"（仅当基家族本身也存在时才收敛，
 * 避免误伤 "Franklin Gothic Medium"、"Cascadia Code Regular" 这类真实注册名）
 */
function collapseFontStyleVariants(families) {
  const allKeys = new Set(families.map((f) => f.toLowerCase()));
  const map = new Map();
  for (const f of families) if (!map.has(f.toLowerCase())) map.set(f.toLowerCase(), f);
  const removed = [];
  for (const [lower, display] of map) {
    let cur = display;
    for (;;) {
      const m = cur.match(FONT_STYLE_SUFFIX_RE);
      if (!m) break;
      const stripped = cur.slice(0, m.index).trim();
      if (stripped && allKeys.has(stripped.toLowerCase())) cur = stripped;
      else break;
    }
    if (cur !== display) removed.push(lower);
  }
  for (const lower of removed) map.delete(lower);
  return [...map.values()];
}

/**
 * 读取字体文件的 OpenType name 表，返回真实家族名集合（nameID 1 与 16，
 * 含中英文本地名）。注册表值名只是安装时写入的显示名，与 CSS/DirectWrite
 * 实际匹配的家族名可能不一致（如注册表 "霞鹜文楷等宽 屏幕阅读版 Regular"
 * 对应文件内真实家族名 "LXGW WenKai Screen"）；以文件内部 name 表为准，
 * font-family 才能真正命中。支持 ttf/otf 与 ttc 集合，解析失败返回空数组。
 */
function readFontFamilyNames(filePath) {
  let fd;
  try {
    fd = fsSync.openSync(filePath, 'r');
  } catch {
    return [];
  }
  const names = new Set();
  try {
    const readChunk = (pos, len) => {
      const b = Buffer.alloc(len);
      let total = 0;
      while (total < len) {
        const n = fsSync.readSync(fd, b, total, len - total, pos + total);
        if (n <= 0) break;
        total += n;
      }
      return b.subarray(0, total);
    };

    const header = readChunk(0, 12);
    if (header.length < 12) return [];
    // TTC 集合：头部列出每个成员 sfnt 的偏移；普通字体只有一个偏移 0
    const sfntOffsets = [];
    if (header.toString('latin1', 0, 4) === 'ttcf') {
      const count = header.readUInt32BE(8);
      if (count === 0 || count > 64) return [];
      const ttc = readChunk(0, 12 + count * 4);
      for (let i = 0; i < count; i++) sfntOffsets.push(ttc.readUInt32BE(12 + i * 4));
    } else {
      sfntOffsets.push(0);
    }

    for (const off of sfntOffsets) {
      const h = off === 0 ? header : readChunk(off, 12);
      if (h.length < 12) continue;
      const numTables = h.readUInt16BE(off + 4);
      if (numTables === 0 || numTables > 256) continue;
      const recs = readChunk(off + 12, numTables * 16);
      let nameOff = -1;
      let nameLen = 0;
      for (let i = 0; i < numTables; i++) {
        const rec = i * 16;
        if (recs.length < rec + 16) break;
        if (recs.toString('latin1', rec, rec + 4) === 'name') {
          nameOff = recs.readUInt32BE(rec + 8);
          nameLen = recs.readUInt32BE(rec + 12);
          break;
        }
      }
      if (nameOff < 0 || nameLen <= 0 || nameLen > 1024 * 1024) continue;
      const nt = readChunk(nameOff, nameLen);
      if (nt.length < 6) continue;
      const count = nt.readUInt16BE(2);
      const strOff = nt.readUInt16BE(4);
      for (let i = 0; i < count; i++) {
        const rec = 6 + i * 12;
        if (rec + 12 > nt.length) break;
        const platform = nt.readUInt16BE(rec);
        const nameId = nt.readUInt16BE(rec + 6);
        const len = nt.readUInt16BE(rec + 8);
        const so = nt.readUInt16BE(rec + 10);
        if ((nameId !== 1 && nameId !== 16) || len === 0) continue;
        const start = strOff + so;
        if (start + len > nt.length) continue;
        let s = '';
        if (platform === 0 || platform === 3) {
          // UTF-16BE → 逐字节交换后按 utf16le 解码
          const seg = Buffer.from(nt.subarray(start, start + len));
          for (let k = 0; k + 1 < seg.length; k += 2) {
            const t = seg[k];
            seg[k] = seg[k + 1];
            seg[k + 1] = t;
          }
          s = seg.toString('utf16le');
        } else if (platform === 1) {
          s = nt.toString('latin1', start, start + len);
        } else {
          continue;
        }
        s = s.trim();
        if (s && !/[\u0000-\u001f]/.test(s)) names.add(s);
      }
    }
  } catch {
    /* 单个文件损坏不影响整体枚举 */
  } finally {
    fsSync.closeSync(fd);
  }
  return [...names];
}

/** 平台枚举结果：families = 去重后的家族名；groups = 每个字体文件的全部
 * 家族名变体（同一字体的中文名/英文名/nameID1/16），供渲染层别名自愈 */
function listWindowsFontFamilies() {
  const fontsDir = path.join(process.env.windir || 'C:\\Windows', 'Fonts');
  const keys = [
    'HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
    'HKCU\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion\\Fonts',
  ];
  // 真实家族名（来自字体文件 name 表，CSS 能命中）优先；
  // 文件读不到时退回注册表值名近似
  const real = new Set();
  const groups = [];
  const fallback = new Set();
  for (const key of keys) {
    let out;
    try {
      // 不传 encoding 拿原始 Buffer，按系统 OEM 代码页解码（中文系统 GBK），
      // 否则中文字体名（如 "霞鹜文楷"、"楷体"）会变乱码、无法搜索
      out = getCliTextDecoder().decode(
        execFileSync('reg', ['query', key], { windowsHide: true, maxBuffer: 16 * 1024 * 1024 })
      );
    } catch {
      continue; // 键不存在（如无每用户字体）则忽略
    }
    for (const line of out.split(/\r?\n/)) {
      // 行格式：<值名>    REG_SZ    <字体文件名/路径>
      const m = line.match(/^(.+?)\s{2,}REG_SZ\s+(.+?)\s*$/i);
      if (!m) continue;
      const fileRaw = m[2].trim();
      const file = path.isAbsolute(fileRaw) ? fileRaw : path.join(fontsDir, fileRaw);
      const families = readFontFamilyNames(file);
      if (families.length) {
        groups.push(families);
        for (const fam of families) real.add(fam);
        continue;
      }
      for (const fam of splitWindowsFontValueName(m[1].trim())) {
        // 注册表值名常把样式词拼在家族名后（如 "霞鹜文楷等宽 屏幕阅读版 Regular"），
        // 而 CSS/DirectWrite 按家族名匹配，必须去掉尾部 " Regular" 才能生效
        const stripped = fam.replace(/[\s_-]+Regular$/i, '').trim();
        fallback.add(stripped || fam);
      }
    }
  }
  if (real.size) return { families: [...real], groups };
  const list = [...fallback];
  return { families: list, groups: list.map((f) => [f]) };
}

function listLinuxFontFamilies() {
  try {
    const out = execFileSync('fc-list', [':', 'family'], { encoding: 'utf8', windowsHide: true });
    const families = new Set();
    for (const line of out.split(/\r?\n/)) {
      for (const fam of line.split(',')) {
        const t = fam.trim();
        if (t) families.add(t);
      }
    }
    const list = [...families];
    return { families: list, groups: list.map((f) => [f]) };
  } catch {
    return { families: [], groups: [] };
  }
}

function listMacFontFamilies() {
  const dirs = [
    '/System/Library/Fonts',
    '/Library/Fonts',
    path.join(os.homedir(), 'Library', 'Fonts'),
  ];
  const families = new Set();
  for (const dir of dirs) {
    let entries;
    try {
      entries = fs.readdirSync(dir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (/\.(ttf|otf|ttc|dfont)$/i.test(entry)) {
        // 文件名近似家族名（macOS 无内置 CLI 可精确枚举，尽力而为）
        families.add(
          entry.replace(/\.(ttf|otf|ttc|dfont)$/i, '').replace(/[-_]+/g, ' ').trim()
        );
      }
    }
  }
  const list = [...families];
  return { families: list, groups: list.map((f) => [f]) };
}

// 枚举系统字体（结果进程内缓存；成功返回 { success, fonts, aliases }）
ipcMain.handle('list-system-fonts', () => {
  if (systemFontsCache) return { success: true, ...systemFontsCache };
  try {
    let result;
    if (process.platform === 'win32') result = listWindowsFontFamilies();
    else if (process.platform === 'darwin') result = listMacFontFamilies();
    else result = listLinuxFontFamilies();
    const fonts = collapseFontStyleVariants(result.families).sort((a, b) =>
      a.localeCompare(b)
    );
    if (!fonts.length) return { success: false, error: '未发现系统字体', fonts: [] };
    // 别名组（同一字体文件的多个家族名，如中英文/typographic 家族名）：
    // 键 = 组内第一个名字，值 = 其余名字；渲染层用它把失效存档名换成能命中的别名
    const aliases = {};
    for (const group of result.groups) {
      if (group.length > 1) aliases[group[0]] = group.slice(1);
    }
    systemFontsCache = { fonts, aliases };
    return { success: true, fonts, aliases };
  } catch (e) {
    console.error('枚举系统字体失败:', e);
    return { success: false, error: e?.message || '枚举系统字体失败', fonts: [] };
  }
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
      // 阅读模式：返回 spine 原始 XHTML，渲染端配合原书 CSS 渲染（bookres 协议供资源）
      const { openEpubReading } = require('./epub-parser');
      const result = openEpubReading(book.filePath);
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

// 添加批注（type 'underline' 携带 pidx/start/end 用于正文渲染划线；旧字段保持兼容）
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
    type: note.type === 'underline' ? 'underline' : 'note',
    createdAt: now,
    updatedAt: now
  };
  // 划线定位信息：TXT=pidx（段落级）/ EPUB=chidx（章节级），区间有效时持久化
  const hasRange = (k) =>
    Number.isInteger(note[k]) && note[k] >= 0 &&
    Number.isInteger(note.start) && Number.isInteger(note.end) && note.end > note.start;
  if (hasRange('pidx') || hasRange('chidx')) {
    if (Number.isInteger(note.pidx) && note.pidx >= 0) fullNote.pidx = note.pidx;
    if (Number.isInteger(note.chidx) && note.chidx >= 0) fullNote.chidx = note.chidx;
    fullNote.start = note.start;
    fullNote.end = note.end;
  }
  book.notes.push(fullNote);
  saveLibrary();
  return { success: true, note: fullNote };
});

// 更新批注（目前仅编辑 content；quote/区间等定位字段不可改，防止与正文高亮错位）
ipcMain.handle('update-note', (event, { bookId, noteId, patch }) => {
  const book = libraryData.books.find(b => b.id === bookId);
  if (!book) return { success: false, error: '书籍不存在' };
  const note = book.notes.find(n => n.id === noteId);
  if (!note) return { success: false, error: '批注不存在' };
  if (patch && typeof patch.content === 'string') note.content = patch.content;
  if (patch && typeof patch.color === 'string' && patch.color) note.color = patch.color;
  note.updatedAt = new Date().toISOString();
  saveLibrary();
  return { success: true, note };
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
    // EPUB 包内资源协议（渲染层 fetch 书内 CSS/图片/字体）
    protocol.handle('bookres', handleBookResRequest);

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
