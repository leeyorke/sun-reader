/**
 * epub-parser 单元测试
 *
 * 不依赖现成 EPUB 文件：用 adm-zip 在临时目录动态构造各种形态的 fixture，
 * 覆盖解析主链路与封面的三级定位策略、异常分支。
 */

import { describe, it, expect, afterEach } from 'vitest';

import AdmZip from 'adm-zip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { parseEpub, extractCover } from '../../src/main/epub-parser.js';

// ---------- fixture 构造 ----------

const CONTAINER = (opfPath) =>
  `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles><rootfile full-path="${opfPath}" media-type="application/oebps-package+xml"/></rootfiles>
</container>`;

function chapterXhtml({ title, body }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${title}</title></head>
<body><h1>${title}</h1>${body}</body></html>`;
}

/**
 * opf 选项：
 *   meta        附加 <metadata> 内部内容（dc:title 等）
 *   manifest    manifest 内部条目文本
 *   spine       spine 内部 itemref 文本
 *   extraMetaTag OPF 中 metadata 之外的附加标签（如 EPUB2 cover meta）
 */
function buildOpf({ meta = '', manifest = '', spine = '', extraMetaTag = '' }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id">
  ${extraMetaTag}
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">${meta}</metadata>
  <manifest>${manifest}</manifest>
  <spine>${spine}</spine>
</package>`;
}

const tmpDirs = [];
function writeEpub(zip) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sun-reader-test-'));
  tmpDirs.push(dir);
  const file = path.join(dir, 'book.epub');
  fs.writeFileSync(file, zip.toBuffer());
  return file;
}

function makeEpub({ opfPath = 'OEBPS/content.opf', container, opf, files = {} }) {
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/epub+zip'));
  zip.addFile('META-INF/container.xml', Buffer.from(container ?? CONTAINER(opfPath)));
  zip.addFile(opfPath, Buffer.from(opf));
  for (const [p, content] of Object.entries(files)) {
    zip.addFile(p, Buffer.from(content));
  }
  return writeEpub(zip);
}

afterEach(() => {
  for (const d of tmpDirs.splice(0)) {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

// ---------- parseEpub ----------

describe('parseEpub', () => {
  it('按 spine 顺序解析章节并提取元数据', () => {
    const opf = buildOpf({
      meta: '<dc:title>测试之书</dc:title><dc:creator>某作者</dc:creator>',
      manifest: `
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
        <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>`,
      spine: `<itemref idref="c1"/><itemref idref="c2"/>`,
    });
    const ncx = `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/"><navMap>
  <navPoint id="n1"><navLabel><text>第一章</text></navLabel><content src="ch1.xhtml"/></navPoint>
  <navPoint id="n2"><navLabel><text>第二章</text></navLabel><content src="ch2.xhtml"/></navPoint>
</navMap></ncx>`;
    const file = makeEpub({
      opf,
      files: {
        'OEBPS/toc.ncx': ncx,
        'OEBPS/ch1.xhtml': chapterXhtml({
          title: '第一章',
          body: '<p>第一段内容。</p><p>第二段内容。</p>',
        }),
        'OEBPS/ch2.xhtml': chapterXhtml({ title: '第二章', body: '<p>第二章正文。</p>' }),
      },
    });

    const r = parseEpub(file);
    expect(r.ok).toBe(true);
    expect(r.meta).toEqual({ title: '测试之书', creator: '某作者' });
    expect(r.chapters.map((c) => c.title)).toEqual(['第一章', '第二章']);
    expect(r.chapters[0].paragraphs).toEqual(['第一章', '第一段内容。', '第二段内容。']);
    expect(r.chapters[1].paragraphs).toEqual(['第二章', '第二章正文。']);
  });

  it('不在目录文档中的章节标题为空（不合成名字）', () => {
    const opf = buildOpf({
      manifest: `<item id="c1" href="x.xhtml" media-type="application/xhtml+xml"/>`,
      spine: `<itemref idref="c1"/>`,
    });
    const file = makeEpub({
      opf,
      files: { 'OEBPS/x.xhtml': chapterXhtml({ title: '内部标题', body: '<p>正文。</p>' }) },
    });

    const r = parseEpub(file);
    expect(r.ok).toBe(true);
    expect(r.chapters[0].title).toBe('');
    // XHTML 内部标题仍作为正文段落保留（h1 独立成段），只是不再充当章节名
    expect(r.chapters[0].paragraphs).toEqual(['内部标题', '正文。']);
  });

  it('章节标题只来自目录文档(NCX)，忽略 XHTML 内部标题', () => {
    // 现实案例：部分书的 h1/title 是作者名等无关信息，只有 toc.ncx 可信
    const opf = buildOpf({
      manifest: `
        <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
        <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>
        <item id="c2" href="ch2.xhtml" media-type="application/xhtml+xml"/>`,
      spine: `<spine toc="ncx"><itemref idref="c1"/><itemref idref="c2"/></spine>`,
    });
    const ncx = `<?xml version="1.0"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <navMap>
    <navPoint id="n1" playOrder="1">
      <navLabel><text>Songsayer</text></navLabel>
      <content src="ch1.xhtml"/>
    </navPoint>
    <navPoint id="n2" playOrder="2">
      <navLabel><text>Gnomebody</text></navLabel>
      <content src="ch2.xhtml#part2"/>
    </navPoint>
  </navMap>
</ncx>`;
    const file = makeEpub({
      opf,
      files: {
        'OEBPS/toc.ncx': ncx,
        'OEBPS/ch1.xhtml': chapterXhtml({ title: 'Wrong Author', body: '<p>a</p>' }),
        'OEBPS/ch2.xhtml': chapterXhtml({ title: 'Also Wrong', body: '<p>b</p>' }),
      },
    });

    const r = parseEpub(file);
    expect(r.ok).toBe(true);
    expect(r.chapters.map((c) => c.title)).toEqual(['Songsayer', 'Gnomebody']);
  });

  it('EPUB3 nav 目录同样生效', () => {
    const opf = buildOpf({
      manifest: `
        <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
        <item id="c1" href="ch1.xhtml" media-type="application/xhtml+xml"/>`,
      spine: `<itemref idref="c1"/>`,
    });
    const nav = `<?xml version="1.0"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<body><nav epub:type="toc"><ol><li><a href="ch1.xhtml">The Real Chapter</a></li></ol></nav></body></html>`;
    const file = makeEpub({
      opf,
      files: {
        'OEBPS/nav.xhtml': nav,
        'OEBPS/ch1.xhtml': '<html><body><p>body only.</p></body></html>',
      },
    });

    const r = parseEpub(file);
    expect(r.ok).toBe(true);
    expect(r.chapters[0].title).toBe('The Real Chapter');
  });

  it('没有目录文档的书所有章节标题为空，不产生合成名字', () => {
    const enFile = makeEpub({
      opf: buildOpf({
        manifest: `
        <item id="c1" href="e1.xhtml" media-type="application/xhtml+xml"/>
        <item id="c2" href="e2.xhtml" media-type="application/xhtml+xml"/>`,
        spine: `<itemref idref="c1"/><itemref idref="c2"/>`,
      }),
      files: {
        'OEBPS/e1.xhtml': '<html><body><p>English content here.</p></body></html>',
        'OEBPS/e2.xhtml': '<html><body><h1>Some Heading</h1><p>More text.</p></body></html>',
      },
    });
    const zhFile = makeEpub({
      opf: buildOpf({
        manifest: `<item id="c1" href="z1.xhtml" media-type="application/xhtml+xml"/>`,
        spine: `<itemref idref="c1"/>`,
      }),
      files: {
        'OEBPS/z1.xhtml': '<html><body><p>中文正文内容。</p></body></html>',
      },
    });

    const en = parseEpub(enFile);
    const zh = parseEpub(zhFile);
    expect(en.chapters.map((c) => c.title)).toEqual(['', '']); // 连 h1 也不作为标题
    expect(zh.chapters.map((c) => c.title)).toEqual(['']);
  });

  it('跳过 spine 中引用的非 XHTML 资源与缺失资源', () => {
    const opf = buildOpf({
      manifest: `
        <item id="pic" href="img.png" media-type="image/png"/>
        <item id="ghost" href="missing.xhtml" media-type="application/xhtml+xml"/>
        <item id="real" href="ok.xhtml" media-type="application/xhtml+xml"/>`,
      spine: `<itemref idref="pic"/><itemref idref="ghost"/><itemref idref="real"/>`,
    });
    const file = makeEpub({
      opf,
      files: { 'OEBPS/ok.xhtml': chapterXhtml({ title: '存在', body: '<p>好。</p>' }) },
    });

    const r = parseEpub(file);
    expect(r.ok).toBe(true);
    expect(r.chapters).toHaveLength(1);
    expect(r.chapters[0].title).toBe(''); // 无目录文档，标题为空
  });

  it('支持子目录中的相对路径资源', () => {
    const opf = buildOpf({
      meta: '<dc:title>子目录</dc:title>',
      manifest: `<item id="c1" href="text/ch1.xhtml" media-type="application/xhtml+xml"/>`,
      spine: `<itemref idref="c1"/>`,
    });
    const file = makeEpub({
      opf,
      files: { 'OEBPS/text/ch1.xhtml': chapterXhtml({ title: '深层', body: '<p>嵌套 OK。</p>' }) },
    });

    const r = parseEpub(file);
    expect(r.ok).toBe(true);
    expect(r.chapters[0].paragraphs.join('')).toContain('嵌套 OK。');
  });

  it('解码正文与元数据里的实体', () => {
    const opf = buildOpf({
      meta: '<dc:title>A &amp; B</dc:title>',
      manifest: `<item id="c1" href="e.xhtml" media-type="application/xhtml+xml"/>`,
      spine: `<itemref idref="c1"/>`,
    });
    const file = makeEpub({
      opf,
      files: {
        'OEBPS/e.xhtml': chapterXhtml({
          title: '引号',
          body: '<p>&quot;你好&#x201C;世界&#x201D;&amp;更多&#8230;&#8230;</p>',
        }),
      },
    });

    const r = parseEpub(file);
    expect(r.ok).toBe(true);
    expect(r.meta.title).toBe('A & B');
    expect(r.chapters[0].paragraphs.join('')).toContain('"你好\u201C世界\u201D&更多……');
  });

  it('没有任何可读章节时返回失败', () => {
    const opf = buildOpf({});
    const file = makeEpub({ opf });
    const r = parseEpub(file);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('没有可读内容');
  });

  it('缺少 container.xml 时返回失败', () => {
    const zip = new AdmZip();
    zip.addFile('anything.txt', Buffer.from('hi'));
    const file = writeEpub(zip);

    const r = parseEpub(file);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('container.xml');
  });

  it('非 ZIP 文件返回打开失败', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sun-reader-test-'));
    tmpDirs.push(dir);
    const file = path.join(dir, 'fake.epub');
    fs.writeFileSync(file, 'this is not a zip archive');

    const r = parseEpub(file);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('无法打开文件');
  });
});

// ---------- extractCover ----------

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG 魔数
const JPG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);

describe('extractCover', () => {
  it('EPUB3 properties="cover-image" 优先级最高', () => {
    const opf = buildOpf({
      manifest: `
        <item id="epub2cover" href="old.jpg" media-type="image/jpeg"/>
        <item id="cover-image" href="new.png" media-type="image/png" properties="cover-image"/>`,
      extraMetaTag: `<meta name="cover" content="epub2cover"/>`,
    });
    const file = makeEpub({
      opf,
      files: { 'OEBPS/old.jpg': JPG_BYTES, 'OEBPS/new.png': PNG_BYTES },
    });

    const r = extractCover(file);
    expect(r.ok).toBe(true);
    expect(r.extension).toBe('.png');
    expect(Buffer.from(r.data)).toEqual(PNG_BYTES);
  });

  it('回退到 EPUB2 meta name="cover" 指向的条目', () => {
    const opf = buildOpf({
      manifest: `<item id="my-cover" href="images/cover.jpeg" media-type="image/jpeg"/>`,
      extraMetaTag: `<meta name="cover" content="my-cover"/>`,
    });
    const file = makeEpub({ opf, files: { 'OEBPS/images/cover.jpeg': JPG_BYTES } });

    const r = extractCover(file);
    expect(r.ok).toBe(true);
    expect(r.extension).toBe('.jpg'); // jpeg 归一化为 jpg
    expect(Buffer.from(r.data)).toEqual(JPG_BYTES);
  });

  it('再回退到文件名 cover.* 约定', () => {
    const opf = buildOpf({
      manifest: `<item id="art" href="cover.png" media-type="image/png"/>`,
    });
    const file = makeEpub({ opf, files: { 'OEBPS/cover.png': PNG_BYTES } });

    const r = extractCover(file);
    expect(r.ok).toBe(true);
    expect(r.extension).toBe('.png');
  });

  it('三种策略都未命中时返回未找到封面', () => {
    const opf = buildOpf({
      manifest: `<item id="c1" href="ch.xhtml" media-type="application/xhtml+xml"/>`,
    });
    const file = makeEpub({
      opf,
      files: { 'OEBPS/ch.xhtml': chapterXhtml({ title: 't', body: '' }) },
    });

    const r = extractCover(file);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('未找到封面');
  });

  it('声明了封面但资源缺失时报资源缺失', () => {
    const opf = buildOpf({
      manifest: `<item id="cover-image" href="gone.png" media-type="image/png" properties="cover-image"/>`,
    });
    const file = makeEpub({ opf }); // 故意不放 gone.png

    const r = extractCover(file);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('封面资源缺失');
  });
});
