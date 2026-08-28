/**
 * epub.ts - EPUB 原书渲染工具
 *
 * 正文不再剥离为纯文本，而是按 spine 原始 XHTML + 原书 CSS 渲染：
 * - bookresUrl/resolveRelativePath：把书内相对路径换算成 bookres:// 协议地址，
 *   由主进程协议处理器从 zip 中读取资源（CSS/图片/字体）；
 * - scopeCss：把原书 CSS 的选择器前缀限定到 #book-flow 容器，
 *   既让原书样式生效，又避免 body/* 级规则污染整个 app；
 * - prepareChapterHtml：DOMParser 净化正文（去 script/事件属性/javascript: 链接），
 *   并把 img/svg/audio 等资源地址重写到 bookres://，书内链接打上 data-* 标记
 *   （点击由 ReaderPage 解释：章节跳转或系统浏览器打开）。
 */

/** 解析相对 baseDir 的 zip 内路径（处理 ../、./ 与重复斜杠），与主进程 resolveZipPath 一致 */
export function resolveRelativePath(baseDir: string, src: string): string {
  const clean = src.split('#')[0].split('?')[0];
  const out: string[] = [];
  for (const part of (baseDir + decodeURIComponent(clean)).split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

/** zip 内路径 → bookres:// 协议地址 */
export function bookresUrl(bookId: string, zipPath: string): string {
  return `bookres://${bookId}/${zipPath.split('/').map(encodeURIComponent).join('/')}`;
}

/**
 * 作用域化 CSS：给每条规则的每个选择器加 #book-flow 前缀。
 * - html/body 开头的选择器替换为容器本身（原书按 body 排版的规则照常生效）；
 * - @media/@supports/@layer/@container 递归处理内部规则；
 * - @font-face/@import 等原样保留。
 */
export function scopeCss(css: string, scope = '#book-flow'): string {
  let out = '';
  let i = 0;
  const n = css.length;
  while (i < n) {
    const braceIdx = css.indexOf('{', i);
    if (braceIdx === -1) {
      out += css.slice(i);
      break;
    }
    const semiIdx = css.indexOf(';', i);
    if (semiIdx !== -1 && semiIdx < braceIdx) {
      out += css.slice(i, semiIdx + 1); // @import / @charset 等语句
      i = semiIdx + 1;
      continue;
    }
    // 找到配对的右大括号（忽略字符串内的括号——书内 CSS 极少出现，风险可接受）
    let depth = 1;
    let j = braceIdx + 1;
    while (j < n && depth > 0) {
      const ch = css[j];
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
      j++;
    }
    const prelude = css.slice(i, braceIdx);
    const body = css.slice(braceIdx + 1, j - 1);
    const trimmed = prelude.trim();

    if (/^@(media|supports|layer|container|scope)\b/i.test(trimmed)) {
      out += `${prelude}{${scopeCss(body, scope)}}`;
    } else if (trimmed.startsWith('@')) {
      out += `${prelude}{${body}}`; // @font-face 等：保留原样（keyframes 名不作用域化）
    } else {
      const scoped = prelude
        .split(',')
        .map((sel) => {
          const s = sel.trim();
          if (!s) return s;
          if (/^(html|body)\b/i.test(s)) return s.replace(/^(html|body)/i, scope);
          if (/^::?(?:selection|first-line|first-letter)\b/i.test(s)) {
            // body::selection 之类：body 部分同样替换
            return s.replace(/^(html|body)/i, scope);
          }
          return `${scope} ${s}`;
        })
        .join(', ');
      out += `${scoped}{${body}}`;
    }
    i = j;
  }
  return out;
}

/** 重写 CSS 文本里的相对 url(...) → bookres:// 地址 */
export function rewriteCssUrls(css: string, cssZipDir: string, bookId: string): string {
  return css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, _quote, raw) => {
    const u = String(raw).trim();
    if (!u || /^(data:|https?:|bookres:|#)/i.test(u)) return m;
    return `url("${bookresUrl(bookId, resolveRelativePath(cssZipDir, u))}")`;
  });
}

/**
 * 移除 CSS 文本中的 font-family 声明。
 * 书常用 .calibre{font-family:...} 类规则压住用户所选字体，这里在注入前统一剥掉
 * （保留其它颜色/间距/装饰），使用户字体通过容器继承生效；代码块字体由阅读器另行兜底。
 * 注意：@font-face 内的 font-family 定义也会被移除——由于用法已一并剥掉，那段面是无用规则。
 */
export function stripFontFamily(css: string): string {
  return css.replace(/font-family\s*:[^;{}]*;?/gi, '');
}

const STRIP_SELECTORS = 'script, style, link, meta, title, iframe, object, embed, form, input, button, select, textarea, noscript';

/**
 * 在 root 内收集覆盖纯文本区间 [start, end) 的静态 Range 列表
 * （CSS Custom Highlight API 渲染 EPUB 划线用；跨元素自动拆分连续区间）
 */
export function collectTextRanges(root: HTMLElement, start: number, end: number): Range[] {
  const out: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let cur: Range | null = null;
  while (walker.nextNode()) {
    const node = walker.currentNode as Text;
    const len = node.data?.length ?? 0;
    const nodeStart = acc;
    const nodeEnd = acc + len;
    acc = nodeEnd;
    if (nodeEnd <= start) continue;
    if (nodeStart >= end) break;
    const s = Math.max(0, start - nodeStart);
    const e = Math.min(len, end - nodeStart);
    if (s >= e) continue;
    if (cur && cur.endContainer === node && cur.endOffset === s) {
      cur.setEnd(node, e); // 同一文本节点内的连续区间合并
    } else {
      cur = document.createRange();
      cur.setStart(node, s);
      cur.setEnd(node, e);
      out.push(cur);
    }
  }
  return out;
}

/**
 * 屏幕坐标 → root 内纯文本偏移（Range.toString() 量长，与划线/批注的
 * start/end 同一套语义）。点击高亮文本反查批注用；不在 root 内返回 -1。
 */
export function textOffsetFromPoint(x: number, y: number, root: HTMLElement): number {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  let node: Node | null = null;
  let offset = 0;
  if (typeof doc.caretPositionFromPoint === 'function') {
    const pos = doc.caretPositionFromPoint(x, y);
    if (!pos) return -1;
    node = pos.offsetNode;
    offset = pos.offset;
  } else if (typeof doc.caretRangeFromPoint === 'function') {
    const r = doc.caretRangeFromPoint(x, y);
    if (!r) return -1;
    node = r.startContainer;
    offset = r.startOffset;
  } else {
    return -1;
  }
  if (!node || !root.contains(node)) return -1;
  const r = document.createRange();
  r.selectNodeContents(root);
  try {
    r.setEnd(node, offset);
  } catch {
    return -1;
  }
  return r.toString().length;
}

/**
 * 净化并重写一章的 body 内层 HTML：
 * - 移除脚本/样式/表单等节点与 on* 事件属性、javascript: 链接；
 * - img/source/audio/video/track/image 的资源地址重写为 bookres://；
 * - <a> 链接改写为 data-book-link（书内跳转）或 data-external-href（外链），
 *   移除原 href 防止默认导航；返回 body.innerHTML。
 */
export function prepareChapterHtml(
  xhtml: string,
  bookId: string,
  chapterZipPath: string
): { html: string; text: string } {
  const doc = new DOMParser().parseFromString(xhtml, 'text/html');
  const body = doc.body;
  if (!body) return { html: '', text: '' };

  body.querySelectorAll(STRIP_SELECTORS).forEach((el) => el.remove());

  const chapterDir = chapterZipPath.includes('/')
    ? chapterZipPath.slice(0, chapterZipPath.lastIndexOf('/') + 1)
    : '';

  const toRes = (raw: string | null): string | null => {
    if (!raw) return null;
    const u = raw.trim();
    if (!u || /^(data:|https?:|bookres:|mailto:|#)/i.test(u)) return null;
    return bookresUrl(bookId, resolveRelativePath(chapterDir, u));
  };

  // 媒体资源
  body.querySelectorAll('img, source, audio, video, track, embed').forEach((el) => {
    for (const attrName of ['src', 'poster', 'data-src']) {
      const v = toRes(el.getAttribute(attrName));
      if (v) el.setAttribute(attrName, v);
    }
    // srcset：逐项重写
    const srcset = el.getAttribute('srcset');
    if (srcset) {
      const rewritten = srcset
        .split(',')
        .map((part) => {
          const seg = part.trim().split(/\s+/);
          const v = toRes(seg[0]);
          return v ? [v, ...seg.slice(1)].join(' ') : '';
        })
        .filter(Boolean)
        .join(', ');
      if (rewritten) el.setAttribute('srcset', rewritten);
      else el.removeAttribute('srcset');
    }
  });

  // SVG <image>（href / xlink:href）
  body.querySelectorAll('image').forEach((el) => {
    for (const attrName of ['href', 'xlink:href']) {
      const v = toRes(el.getAttribute(attrName));
      if (v) el.setAttribute(attrName, v);
    }
  });

  // 链接：书内跳转 / 外链
  body.querySelectorAll('a[href]').forEach((el) => {
    const href = el.getAttribute('href') ?? '';
    el.removeAttribute('href');
    if (/^(https?:|mailto:)/i.test(href)) {
      el.setAttribute('data-external-href', href);
      return;
    }
    if (href.startsWith('#')) {
      // 章内锚点：保留 id 供滚跳（当前版本忽略，仅保留文字）
      return;
    }
    el.setAttribute('data-book-link', resolveRelativePath(chapterDir, href));
    el.setAttribute('data-book-fragment', href.includes('#') ? href.split('#')[1] ?? '' : '');
  });

  // 清掉所有 on* 事件属性与 javascript: href；并剥除元素 style 属性内的 font-family
  //（书内联样式栈是压住用户字体的最后一条路径，CSS 文件与 <style> 已在上游剥离）
  body.querySelectorAll('*').forEach((el) => {
    for (const attr of [...el.attributes]) {
      const name = attr.name.toLowerCase();
      if (name.startsWith('on')) el.removeAttribute(attr.name);
      if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attr.value)) {
        el.removeAttribute(attr.name);
      }
    }
    const styleAttr = el.getAttribute('style');
    if (styleAttr && /font-family/i.test(styleAttr)) {
      const cleaned = styleAttr.replace(/font-family\s*:[^;]*;?/gi, '').trim();
      if (cleaned) el.setAttribute('style', cleaned);
      else el.removeAttribute('style');
    }
  });

  // 图片懒加载：多列内容全部存在于 DOM，非当前屏的图不必立即解码
  body.querySelectorAll('img').forEach((el) => el.setAttribute('loading', 'lazy'));

  return { html: body.innerHTML, text: body.textContent ?? '' };
}
