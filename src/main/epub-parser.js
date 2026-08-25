/**
 * Sun Reader - EPUB 解析器
 *
 * EPUB 本质是 ZIP：META-INF/container.xml 指向 OPF 包文档，
 * OPF 的 manifest 列出所有资源、spine 定义阅读顺序。
 * 这里按 spine 顺序抽取每章 XHTML，转为纯文本段落，
 * 供渲染端复用 TXT 阅读管线（搜索/书签/批注/双页/沉浸全部兼容）。
 *
 * 独立运行调试：node epub-parser.js <path-to-epub>
 */

const AdmZip = require('adm-zip');

/** XML 实体解码（覆盖常见命名实体 + 十六进制/十进制数字实体） */
const NAMED_ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'",
  nbsp: ' ', ldquo: '\u201C', rdquo: '\u201D',
  lsquo: '\u2018', rsquo: '\u2019', hellip: '\u2026',
  mdash: '\u2014', ndash: '\u2013', copy: '\u00A9',
};

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => NAMED_ENTITIES[name] ?? m);
}

function attr(tag, name) {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i'));
  return m ? m[1] : null;
}

/** XHTML → { title, paragraphs } */
function xhtmlToChapter(raw, zip, basePath) {
  let html = raw;

  // 去掉 head/style/script，避免样式文本混入正文
  html = html.replace(/<head[\s\S]*?<\/head>/gi, '')
             .replace(/<style[\s\S]*?<\/style>/gi, '')
             .replace(/<script[\s\S]*?<\/script>/gi, '');

  // 章节标题：<title> 或第一个 h1-h6
  let title = '';
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  if (titleMatch) title = decodeEntities(titleMatch[1]).trim();
  if (!title) {
    const h = html.match(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/i);
    if (h) title = decodeEntities(h[1].replace(/<[^>]+>/g, '')).trim();
  }

  // 块级元素闭合处断行；<br> 断行；其余标签剔除
  html = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr|section|article)>/gi, '\n')
    .replace(/<[^>]+>/g, '');

  html = decodeEntities(html);

  const paragraphs = html
    .split(/\r?\n/)
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  // 相对路径引用的图片资源不处理（v1 纯文本）；但保留接口便于扩展
  void zip;
  void basePath;

  return { title, paragraphs };
}

/**
 * 打开 EPUB 并定位 OPF 包文档（parseEpub / extractCover 共用）
 */
function loadPackage(filePath) {
  let zip;
  try {
    zip = new AdmZip(filePath);
  } catch (e) {
    return { ok: false, error: `无法打开文件: ${e.message}` };
  }

  const readText = (path) => {
    const entry = zip.getEntry(path);
    if (!entry) return null;
    return entry.getData().toString('utf8');
  };

  const container = readText('META-INF/container.xml');
  if (!container) return { ok: false, error: '无效的 EPUB：缺少 META-INF/container.xml' };
  const opfPathRaw = (container.match(/<rootfile[^>]+full-path\s*=\s*["']([^"']+)["']/i) || [])[1];
  if (!opfPathRaw) return { ok: false, error: '无效的 EPUB：container.xml 中未找到 rootfile' };
  const opfPath = decodeURIComponent(opfPathRaw);

  const opf = readText(opfPath);
  if (!opf) return { ok: false, error: `无效的 EPUB：找不到包文档 ${opfPath}` };

  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  return { ok: true, zip, readText, opf, opfDir };
}

/** 收集 manifest 清单条目 */
function readManifest(opf) {
  const items = [];
  const itemRe = /<item\b[^>]*>/gi;
  let m;
  while ((m = itemRe.exec(opf)) !== null) {
    const tag = m[0];
    items.push({
      id: attr(tag, 'id'),
      href: attr(tag, 'href'),
      mediaType: attr(tag, 'media-type') || '',
      properties: attr(tag, 'properties') || '',
    });
  }
  return items;
}

/** 解析相对 baseDir 的 ZIP 内路径（处理 ../、./ 与重复斜杠） */
function resolveZipPath(baseDir, src) {
  const out = [];
  for (const part of (baseDir + src).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/**
 * 从目录文档（EPUB2 toc.ncx / EPUB3 nav.xhtml）提取 完整zip路径 → 章节标题 映射。
 * 很多书的 XHTML 内部缺少规范标题（甚至误用作者名），目录文件里的名字最可靠。
 */
function buildTocTitles(readText, opfDir, items, spineTocId) {
  const map = new Map();

  // 定位目录文档：spine@toc → ncx media-type → properties="nav"
  let tocPath = null;
  if (spineTocId) {
    const byId = items.find((i) => i.id === spineTocId);
    if (byId && byId.href) tocPath = resolveZipPath(opfDir, decodeURIComponent(byId.href));
  }
  if (!tocPath) {
    const ncx = items.find((i) => i.mediaType === 'application/x-dtbncx+xml' && i.href);
    if (ncx) tocPath = resolveZipPath(opfDir, decodeURIComponent(ncx.href));
  }
  if (!tocPath) {
    const nav = items.find((i) => /\bnav\b/i.test(i.properties) && i.href);
    if (nav) tocPath = resolveZipPath(opfDir, decodeURIComponent(nav.href));
  }
  if (!tocPath) return map;

  const raw = readText(tocPath);
  if (!raw) return map;

  const tocDir = tocPath.includes('/') ? tocPath.slice(0, tocPath.lastIndexOf('/') + 1) : '';

  if (/\.ncx$/i.test(tocPath)) {
    // EPUB2 NCX：<navLabel><text>标题</text></navLabel><content src="ch1.xhtml"/>
    const re = /<navLabel[^>]*>\s*<text[^>]*>([\s\S]*?)<\/text>\s*<\/navLabel>\s*<content\s+src\s*=\s*["']([^"']+)["']/gi;
    let m;
    while ((m = re.exec(raw)) !== null) {
      const title = decodeEntities(m[1].replace(/<[^>]+>/g, '')).trim();
      const href = resolveZipPath(tocDir, decodeURIComponent(m[2].split('#')[0]));
      if (title && href && !map.has(href)) map.set(href, title);
    }
  } else {
    // EPUB3 Nav：优先 epub:type="toc" 的 <nav> 块，否则第一个 nav 块
    let block = null;
    const navRe = /<nav\b[^>]*>([\s\S]*?)<\/nav>/gi;
    let nm;
    while ((nm = navRe.exec(raw)) !== null) {
      if (/epub:type\s*=\s*["'][^"']*toc/i.test(nm[0])) {
        block = nm[1];
        break;
      }
      if (block === null) block = nm[1];
    }
    if (block) {
      const aRe = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
      let am;
      while ((am = aRe.exec(block)) !== null) {
        const href = resolveZipPath(tocDir, decodeURIComponent(am[1].split('#')[0]));
        const title = decodeEntities(am[2].replace(/<[^>]+>/g, '')).trim();
        if (title && href && !map.has(href)) map.set(href, title);
      }
    }
  }

  return map;
}

/**
 * 解析 EPUB
 * 章节标题只取自目录文档（NCX/Nav）；不在目录中的章节 title 为空串，不做合成。
 * @returns {{ ok: true, meta: {title,creator}, chapters: Array<{title: string, paragraphs: string[]}> }
 *          | { ok: false, error: string }}
 */
function parseEpub(filePath) {
  const pkg = loadPackage(filePath);
  if (!pkg.ok) return pkg;
  const { zip, readText, opf, opfDir } = pkg;

  // metadata
  const metaTitle = (opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i) || [])[1];
  const metaCreator = (opf.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/i) || [])[1];

  const manifest = new Map(); // id -> { href, mediaType }
  for (const item of readManifest(opf)) {
    if (item.id && item.href) manifest.set(item.id, { href: item.href, mediaType: item.mediaType });
  }

  const spineIds = [];
  const itemrefRe = /<itemref\b[^>]*idref\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = itemrefRe.exec(opf)) !== null) spineIds.push(m[1]);

  // spine 声明的目录文档（EPUB2: <spine toc="ncx-id">）
  const spineTag = (opf.match(/<spine\b[^>]*>/i) || [])[0] || '';
  const spineTocId = attr(spineTag, 'toc');

  const items = readManifest(opf);
  const tocTitles = buildTocTitles(readText, opfDir, items, spineTocId);

  // 按 spine 抽取各章。章节标题只来自目录文档（NCX/Nav）：
  // 不在目录中的章节 title 为空字符串——不合成任何名字，避免与源目录混排。
  const chapters = [];
  for (const id of spineIds) {
    const item = manifest.get(id);
    if (!item) continue;
    if (item.mediaType && !/xhtml|html/i.test(item.mediaType)) continue; // 跳过图片等资源页

    const href = decodeURIComponent(item.href);
    const fullPath = resolveZipPath(opfDir, href);
    const raw = readText(fullPath);
    if (!raw) continue;

    const { paragraphs } = xhtmlToChapter(raw, zip, fullPath);
    chapters.push({
      title: tocTitles.get(fullPath) || '',
      paragraphs,
    });
  }

  if (chapters.length === 0) {
    return { ok: false, error: '解析成功但没有可读内容（可能受 DRM 保护或结构异常）' };
  }

  return {
    ok: true,
    meta: {
      title: metaTitle ? decodeEntities(metaTitle).trim() : '',
      creator: metaCreator ? decodeEntities(metaCreator).trim() : '',
    },
    chapters,
  };
}

/**
 * 提取封面图片
 * 定位优先级：EPUB3 properties="cover-image" → EPUB2 meta name="cover" → 文件名 cover.*
 * @returns {{ ok: true, data: Buffer, extension: string } | { ok: false, error: string }}
 */
function extractCover(filePath) {
  const pkg = loadPackage(filePath);
  if (!pkg.ok) return pkg;
  const { zip, opf, opfDir } = pkg;

  const items = readManifest(opf);

  let target =
    items.find((i) => /\bcover-image\b/i.test(i.properties)) || null;

  if (!target) {
    const metaTag = (opf.match(/<meta\b[^>]*name\s*=\s*["']cover["'][^>]*>/i) || [])[0];
    if (metaTag) {
      const coverId = attr(metaTag, 'content');
      target = items.find((i) => i.id === coverId) || null;
    }
  }

  if (!target) {
    target = items.find((i) => /cover\.(jpe?g|png|gif|webp)$/i.test(i.href || '')) || null;
  }

  if (!target || !/^image\//i.test(target.mediaType)) {
    return { ok: false, error: '未找到封面' };
  }

  const entry = zip.getEntry(opfDir + decodeURIComponent(target.href));
  if (!entry) return { ok: false, error: '封面资源缺失' };

  const extMatch = target.href.match(/\.(jpe?g|png|gif|webp)$/i);
  let ext = extMatch
    ? extMatch[1].toLowerCase()
    : (target.mediaType.split('/')[1] || 'jpg');
  if (ext === 'jpeg') ext = 'jpg';
  if (!['jpg', 'png', 'gif', 'webp'].includes(ext)) ext = 'jpg';

  return { ok: true, data: entry.getData(), extension: `.${ext}` };
}

module.exports = { parseEpub, extractCover };

// CLI 调试入口
if (require.main === module) {
  const path = process.argv[2];
  if (!path) {
    console.log('用法: node epub-parser.js <epub 文件路径>');
    process.exit(0);
  }
  const t0 = Date.now();
  const result = parseEpub(path);
  if (!result.ok) {
    console.error('解析失败:', result.error);
    process.exit(1);
  }
  console.log(`元数据: 《${result.meta.title}》 ${result.meta.creator}`);
  console.log(`章节数: ${result.chapters.length}，耗时 ${Date.now() - t0}ms`);
  for (const ch of result.chapters) {
    const preview = ch.paragraphs[0]?.slice(0, 40) ?? '(空章节)';
    console.log(`  - ${ch.title} (${ch.paragraphs.length} 段) ${preview}...`);
  }
  const cover = extractCover(path);
  console.log(
    cover.ok
      ? `封面: ${cover.extension}, ${cover.data.length} 字节`
      : `封面: 未找到 (${cover.error})`
  );
}
