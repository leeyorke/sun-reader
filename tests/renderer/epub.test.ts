/**
 * epub.ts 纯函数测试：作用域化 CSS、zip 路径解析、bookres 地址。
 * prepareChapterHtml 依赖浏览器 DOM（DOMParser），在 node 环境不可测，这里聚焦纯字符串逻辑。
 */
import { describe, it, expect } from 'vitest';
import {
  scopeCss,
  resolveRelativePath,
  bookresUrl,
  stripFontFamily,
} from '../../src/renderer/src/lib/epub';

describe('resolveRelativePath', () => {
  it('解析 ../、./、重复斜杠', () => {
    expect(resolveRelativePath('OEBPS/text/', '../Styles/main.css')).toBe('OEBPS/Styles/main.css');
    expect(resolveRelativePath('OEBPS/text/', 'images/a.png')).toBe('OEBPS/text/images/a.png');
    expect(resolveRelativePath('OEBPS/', './x/y.css')).toBe('OEBPS/x/y.css');
    expect(resolveRelativePath('', 'ch1.xhtml')).toBe('ch1.xhtml');
  });
  it('剥离锚点与查询串', () => {
    expect(resolveRelativePath('OEBPS/', 'style.css#x')).toBe('OEBPS/style.css');
    expect(resolveRelativePath('OEBPS/', 'style.css?v=1')).toBe('OEBPS/style.css');
  });
});

describe('bookresUrl', () => {
  it('对每段路径编码并拼接', () => {
    expect(bookresUrl('book_1', 'OEBPS/Styles/style.css')).toBe(
      'bookres://book_1/OEBPS/Styles/style.css'
    );
    expect(bookresUrl('book_1', 'OEBPS/字体/文楷.ttf')).toBe(
      'bookres://book_1/OEBPS/%E5%AD%97%E4%BD%93/%E6%96%87%E6%A5%B7.ttf'
    );
  });
});

describe('scopeCss', () => {
  const scope = '#book-flow .epub-chapter[data-chidx="0"]';

  it('把 body 选择器替换为作用域，其余选择器加作用域前缀', () => {
    const css = 'body { text-align: center } p.calibre { color: red }';
    const out = scopeCss(css, scope);
    // scopeCss 输出不带空前大括号（CSS 合法）
    expect(out).toContain(`${scope}{ text-align: center }`);
    expect(out).toContain(`${scope} p.calibre{ color: red }`);
  });

  it('递归处理 @media，保留 @font-face 原样', () => {
    const css = '@media (max-width:100px){ body { color:red } }@font-face{font-family:X;src:url(a.woff)}';
    const out = scopeCss(css, scope);
    expect(out).toContain(`@media (max-width:100px){`);
    expect(out).toContain(`${scope}{ color:red }`);
    expect(out).toContain('@font-face{font-family:X;src:url(a.woff)}');
  });

  it('把选择器列表逐项作用域化且逗号保留', () => {
    const out = scopeCss('h1, h2 p, body { margin: 0 }', scope);
    expect(out).toContain(`${scope} h1, ${scope} h2 p, ${scope}{ margin: 0 }`);
  });

  it('处理多行/带大括号的规则体', () => {
    const css = 'body {\n  margin: 0;\n  padding: 1px;\n}';
    const out = scopeCss(css, scope);
    expect(out).toContain(`${scope}{`);
    expect(out).toContain('margin: 0;');
    expect(out).toContain('padding: 1px;');
  });
});

describe('stripFontFamily', () => {
  it('移除 font-family 声明，保留其它属性', () => {
    const css = 'body { font-family: sans-serif; color: red; margin: 0 }';
    const out = stripFontFamily(css);
    expect(out).not.toContain('font-family');
    expect(out).toContain('color: red');
    expect(out).toContain('margin: 0');
  });
  it('处理无分号的单声明与多行', () => {
    expect(stripFontFamily('.calibre{font-family:\'X\',serif}')).toBe('.calibre{}');
    expect(stripFontFamily('p{font-family:X;\ncolor:red}')).toBe('p{\ncolor:red}');
  });
  it('保留 @font-face 之外的无 font-family 块', () => {
    expect(stripFontFamily('h1{color:red;font-weight:700}')).toBe('h1{color:red;font-weight:700}');
  });
});
