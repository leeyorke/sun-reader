/**
 * ReaderPage - 阅读页（单一双页视图）
 *
 * 打开书籍直接进入全屏双页阅读（CSS 多列分页，无顶栏/底栏/进度条）：
 * - dock 工具栏（DualPageView 内）：退出阅读页面、翻页、字号、主题、搜索、书签，
 *   以及 目录 / 书签 / 我的批注 三个弹窗入口；
 * - 正文以「块」渲染：章节标题加粗并强制从新页开始；段落按划线区间切段，
 *   行内 markdown 链接/加粗/裸 URL 转为友好样式（链接点击用系统浏览器打开）；
 * - 键盘：←/→/PgUp/PgDn/Space 翻页；Esc 依次关闭 批注编辑框 → 选区操作条 →
 *   功能弹窗 → 搜索，最后退出阅读页面。
 */

import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  Check,
  Highlighter,
  Maximize,
  Minus,
  Plus,
  StickyNote,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchModal } from '@/components/reader/SearchModal';
import { DualPageView } from '@/components/reader/DualPageView';
import { BookmarksModal, NotesModal, TocModal } from '@/components/reader/reader-modals';
import { ANNOTATION_COLORS, FONT_SIZE_STEP, READER_MONO_FAMILY } from '@/lib/constants';
import { cn } from '@/lib/utils';
import {
  clampFontSize,
  healStoredFontFamily,
  isFontFamilyAvailable,
  loadReaderPrefs,
  resolveFontFamily,
  saveReaderPrefs,
  type ReaderPrefs,
} from '@/lib/prefs';
import { renderInlineMarkup } from '@/lib/richtext';
import {
  bookresUrl,
  collectTextRanges,
  prepareChapterHtml,
  rewriteCssUrls,
  scopeCss,
  stripFontFamily,
  textOffsetFromPoint,
} from '@/lib/epub';
import {
  getSelectionRange,
  getSelectionRangeByChapter,
  segmentParagraph,
  type TextSegment,
} from '@/lib/selection';
import { useBook, useBookCover, BOOKS_QUERY_KEY } from '@/hooks/useBooks';
import type { PagerHandle } from '@/hooks/useColumnPagination';
import type { Book, Bookmark, Note, ReaderBlock, TocItem } from '@/lib/types';

const CHAPTER_RE =
  /^(第\s*[一二三四五六七八九十百千万零〇\d]+\s*[章节回卷部集]|序章|序言|前言|引子|尾声|后记|番外|楔子).{0,30}$/;

/** EPUB 章节渲染数据（净化后的 body HTML + 原书 CSS + 纯文本镜像） */
interface EpubChapter {
  chidx: number;
  title: string;
  /** 章节 XHTML 在 zip 内的完整路径（书内链接解析基准） */
  zipPath: string;
  html: string;
  text: string;
  /** 本章原书 CSS，作用域化为 #book-flow .epub-chapter[data-chidx="i"]（只影响本章） */
  css: string;
  /** 正文图片数量（识别原书自带的「纯封面图」页） */
  imageCount: number;
}

interface EpubContent {
  chapters: EpubChapter[];
  /** 共享样式表（<link> 引入）去重后合并：作用域一次，避免 127 章重复 6 万条规则 */
  sharedCss: string;
}

/** 划线高亮伪类样式：按 ANNOTATION_COLORS 序号命名 */
const HIGHLIGHT_CSS = ANNOTATION_COLORS.map(
  (c, i) =>
    `::highlight(note-hl-${i}){background-color:${c.value}26;text-decoration:underline;text-decoration-color:${c.value};text-underline-offset:0.18em;}`
).join('\n');

/**
 * 用户排版兜底：单条规则覆盖容器与全部后代（书内一切 font 来源已在注入前剥离：
 * 共享 CSS / 章内 <style> / 元素 style 属性），代码块由后续等宽规则恢复。
 * 随 prefs 变化重建实时生效。
 */
const READER_MONO = READER_MONO_FAMILY;
function readerTypographyCss(prefs: ReaderPrefs): string {
  const user = resolveFontFamily(prefs.fontFamily);
  return [
    `#book-flow, #book-flow * { font-family: ${user} !important; }`,
    `#book-flow pre, #book-flow code, #book-flow samp, #book-flow kbd, #book-flow var { font-family: ${READER_MONO} !important; }`,
    `#book-flow { font-size: ${prefs.fontSize}px !important; line-height: ${prefs.lineHeight} !important; letter-spacing: ${prefs.letterSpacing}em !important; }`,
  ].join('\n');
}

/** 选区相对正文的位置（TXT 同段落 / EPUB 同章节内才可划线） */
interface SelectionRange {
  pidx?: number;
  chidx?: number;
  start: number;
  end: number;
}

type ActiveModal = 'toc' | 'bookmarks' | 'notes' | null;

export function ReaderPage() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: book, isLoading: bookLoading } = useBook(bookId);

  // ---------- 内容状态 ----------
  interface Section {
    title: string;
    /** 结构化块：'p' 段落 / 'h1'-'h6' 文内标题 / 'pre' 代码块（TXT 路径） */
    blocks: Array<{ kind: string; text: string }>;
  }
  const [sections, setSections] = React.useState<Section[] | null>(null);
  /** EPUB 原书渲染状态（非 null 表示当前书按原书 XHTML+CSS 渲染） */
  const [epub, setEpub] = React.useState<EpubContent | null>(null);
  const [unsupportedFormat, setUnsupportedFormat] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);
  /** 章节构建进度（大书要解析上百章，进度比空转的转圈更有信息量） */
  const [buildProgress, setBuildProgress] = React.useState<{ done: number; total: number } | null>(
    null
  );
  const { data: coverRes } = useBookCover(bookId);
  const coverUrl = coverRes?.dataUrl ?? null;

  // ---------- 阅读设置（字号/行高/字体，与设置页共用存储） ----------
  const [prefs, setPrefs] = React.useState<ReaderPrefs>(loadReaderPrefs);
  const setFontSize = (size: number) =>
    setPrefs((p) => {
      const next = { ...p, fontSize: clampFontSize(size) };
      saveReaderPrefs(next);
      return next;
    });

  // 字体名失效自愈：旧版本存下的名字（乱码/注册表近似名）命中不了字体时，
  // 借助系统字体名单换一个能命中的别名，避免静默回退成别的字体
  React.useEffect(() => {
    const name = prefs.fontFamily;
    if (isFontFamilyAvailable(name)) return;
    let alive = true;
    healStoredFontFamily(name).then((fixed) => {
      if (!alive || !fixed) return;
      setPrefs((p) => {
        if (p.fontFamily !== name) return p;
        const next = { ...p, fontFamily: fixed };
        saveReaderPrefs(next);
        return next;
      });
    });
    return () => {
      alive = false;
    };
  }, [prefs.fontFamily]);

  // ---------- 阅读位置 ----------
  const [progressPct, setProgressPct] = React.useState(0);
  const [currentChapter, setCurrentChapter] = React.useState('');
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [activeModal, setActiveModal] = React.useState<ActiveModal>(null);
  /** 全图查看弹窗（图片放不下/看不清时点击查看，支持缩放） */
  const [lightbox, setLightbox] = React.useState<{ src: string; alt: string } | null>(null);
  // ---------- 点击划线/批注高亮处 → 弹出批注阅览 ----------
  const [notePopup, setNotePopup] = React.useState<{ note: Note; x: number; y: number } | null>(
    null
  );

  /** 全图查看弹窗的缩放/平移（换图或关闭时复位） */
  const [lbZoom, setLbZoom] = React.useState(1);
  const [lbPan, setLbPan] = React.useState({ x: 0, y: 0 });
  const lbDragRef = React.useRef<{ sx: number; sy: number; px: number; py: number; moved: boolean } | null>(null);
  React.useEffect(() => {
    setLbZoom(1);
    setLbPan({ x: 0, y: 0 });
    lbDragRef.current = null;
  }, [lightbox?.src]);

  const clampLbZoom = (z: number) => Math.max(0.25, Math.min(6, Math.round(z * 100) / 100));
  const zoomBy = (factor: number) => setLbZoom((z) => clampLbZoom(z * factor));
  const resetLbView = () => {
    setLbZoom(1);
    setLbPan({ x: 0, y: 0 });
  };

  const progressRef = React.useRef(0);
  const dualPagerRef = React.useRef<PagerHandle>(null);

  // ---------- 书签 ----------
  const [bookmarkTick, setBookmarkTick] = React.useState(0);
  const refreshBookData = React.useCallback(() => {
    qc.invalidateQueries({ queryKey: BOOKS_QUERY_KEY });
    setBookmarkTick((t) => t + 1);
  }, [qc]);

  const isBookmarked = React.useMemo(() => {
    void bookmarkTick;
    return (
      book?.bookmarks?.some((bm) => Math.abs(bm.position - progressRef.current) < 1) ?? false
    );
  }, [book, bookmarkTick]);

  // ---------- 划线 / 批注 ----------
  const [selectionPopup, setSelectionPopup] = React.useState<{
    x: number;
    y: number;
    quote: string;
    /** 同段落选区才有值；跨段落仅支持批注 */
    range: SelectionRange | null;
  } | null>(null);
  const [popupColor, setPopupColor] = React.useState<string>(ANNOTATION_COLORS[0].value);
  const [noteDraft, setNoteDraft] = React.useState<{
    quote: string;
    content: string;
    color: string;
    range: SelectionRange | null;
  } | null>(null);

  /** 划线区间按段落索引归组（含带区间的批注），供正文渲染高亮 */
  const underlineRangesByPidx = React.useMemo(() => {
    const map = new Map<number, Array<{ start: number; end: number; color: string }>>();
    for (const n of book?.notes ?? []) {
      if (n.pidx == null || n.start == null || n.end == null || n.end <= n.start) continue;
      const arr = map.get(n.pidx) ?? [];
      arr.push({ start: n.start, end: n.end, color: n.color });
      map.set(n.pidx, arr);
    }
    return map;
  }, [book?.notes]);

  /**
   * 原书自带的「纯封面图」页（calibre 的 titlepage.xhtml 之类：spine 首项、
   * 一张图、没有文字）。阅读器已经用抽取出的封面渲染了首页，两者相邻会让
   * 首屏出现两张封面图；有抽取封面时就跳过原书那页（否则保留它当封面）。
   */
  const duplicateCoverChidx = React.useMemo(() => {
    if (!coverUrl) return null;
    const first = epub?.chapters.find((c) => c.html);
    if (!first || first.chidx !== 0) return null;
    if (first.text.trim().length > 0 || first.imageCount < 1) return null;
    return first.chidx;
  }, [epub, coverUrl]);

  // ---------- 内容加载 ----------
  React.useEffect(() => {
    let cancelled = false;
    setSections(null);
    setEpub(null);
    setLoadError(null);
    setUnsupportedFormat(null);
    setBuildProgress(null);
    setProgressPct(0);
    setCurrentChapter('');
    progressRef.current = 0;

    if (!bookId || !window.electronAPI) return;
    window.electronAPI.books.readContent(bookId).then(async (res) => {
      if (cancelled) return;
      if (!res.success) {
        setLoadError(res.error ?? '读取失败');
        return;
      }
      const fmt = (res.format ?? '').toLowerCase();

      if (fmt === 'epub' && res.chapters?.length) {
        const total = res.chapters.length;
        const cts = res.chapters;
        const chapters: EpubChapter[] = new Array(total);
        const sharedCssPerChapter: string[] = new Array(total);
        const fetchedHrefs = new Set<string>();
        const SHARED_SCOPE = '#book-flow .epub-chapter[data-chidx]';
        const CONCURRENCY = 6;
        setBuildProgress({ done: 0, total });

        const buildOne = async (i: number) => {
          const ch = cts[i];
          const xhtml = ch.xhtml ?? '';
          const zipPath = ch.href ?? `chapter-${i}.xhtml`;
          const chapterDir = zipPath.includes('/')
            ? zipPath.slice(0, zipPath.lastIndexOf('/') + 1)
            : '';
          const chapterScope = `#book-flow .epub-chapter[data-chidx="${i}"]`;
          const sharedCss: string[] = [];

          // 一次 DOMParser 同时产出正文与本章样式来源（百章大书解析成本减半）
          const prepared = prepareChapterHtml(xhtml, bookId, zipPath);

          for (const cssPath of prepared.cssHrefs) {
            if (fetchedHrefs.has(cssPath)) continue;
            fetchedHrefs.add(cssPath);
            const cssDir = cssPath.includes('/')
              ? cssPath.slice(0, cssPath.lastIndexOf('/') + 1)
              : '';
            try {
              const r = await fetch(bookresUrl(bookId, cssPath));
              if (r.ok) {
                sharedCss.push(
                  scopeCss(
                    stripFontFamily(rewriteCssUrls(await r.text(), cssDir, bookId)),
                    SHARED_SCOPE
                  )
                );
              }
            } catch {
              /* 缺失样式文件静默跳过 */
            }
          }

          const inlineCss = prepared.inlineCss.map((css) =>
            scopeCss(stripFontFamily(rewriteCssUrls(css, chapterDir, bookId)), chapterScope)
          );

          chapters[i] = {
            chidx: i,
            title: ch.title ?? '',
            zipPath,
            html: prepared.html,
            text: prepared.text,
            css: inlineCss.join('\n'),
            imageCount: prepared.imageCount,
          };
          sharedCssPerChapter[i] = sharedCss.join('\n');
        };

        for (let base = 0; base < total; base += CONCURRENCY) {
          const batch = [];
          for (let k = base; k < Math.min(base + CONCURRENCY, total); k++) batch.push(buildOne(k));
          await Promise.all(batch);
          if (cancelled) return;
          setBuildProgress({ done: Math.min(base + CONCURRENCY, total), total });
          // 让出一个宏任务：样式表命中缓存后整个循环只有微任务，React 排不上队，
          // 百章大书会「卡住」两秒而进度文案一次都刷不出来
          await new Promise((r) => setTimeout(r, 0));
        }
        if (cancelled) return;
        setEpub({
          chapters,
          sharedCss: sharedCssPerChapter.filter(Boolean).join('\n'),
        });
        return;
      }
      if (fmt === 'txt') {
        setSections([
          {
            title: '',
            blocks: (res.content ?? '')
              .split(/\r?\n+/)
              .map((s) => s.trim())
              .filter(Boolean)
              .map((t) => ({ kind: 'p', text: t })),
          },
        ]);
        return;
      }
      setUnsupportedFormat(res.format?.toUpperCase() ?? fmt.toUpperCase());
    });
    return () => {
      cancelled = true;
    };
  }, [bookId]);

  /**
   * 展平的文本单元（全局索引供搜索/跳转/进度估算使用）：
   * TXT = 正文块；EPUB = 章（一个章节一个文本单元）
   */
  const flatTexts = React.useMemo(() => {
    if (epub) return epub.chapters.map((c) => c.text);
    return sections?.flatMap((s) => s.blocks.map((b) => b.text)) ?? [];
  }, [epub, sections]);

  /**
   * 正文块：章节标题在前、内容块跟随。
   * 解析器的 'h1'-'h6' → heading（带级别，加粗缩放显示），'pre' → 代码块；
   * data-pidx 挂在所有内容块上，与 flatTexts 的全局索引一致。
   */
  const blocks = React.useMemo<ReaderBlock[]>(() => {
    const out: ReaderBlock[] = [];
    let idx = 0;
    for (const s of sections ?? []) {
      if (s.title) out.push({ kind: 'title', text: s.title });
      for (const b of s.blocks) {
        if (/^h[1-6]$/.test(b.kind)) {
          out.push({ kind: 'heading', level: Number(b.kind[1]), text: b.text, pidx: idx++ });
        } else if (b.kind === 'pre') {
          out.push({ kind: 'pre', text: b.text, pidx: idx++ });
        } else {
          out.push({ kind: 'para', text: b.text, pidx: idx++ });
        }
      }
    }
    return out;
  }, [sections]);

  /** 全文字符数（估算页数用） */
  const totalChars = React.useMemo(() => flatTexts.join('').length, [flatTexts]);

  /**
   * 目录：EPUB 按章边界（position = chidx）；
   * TXT 多节按节边界，单节回退正则识别章节标题（position = 块索引）
   */
  const toc: TocItem[] = React.useMemo(() => {
    const items: TocItem[] = [];
    if (epub) {
      for (const c of epub.chapters) {
        if (c.title) items.push({ title: c.title, position: c.chidx, level: 1 });
      }
      return items;
    }
    let idx = 0;
    for (const s of sections ?? []) {
      if (s.title) items.push({ title: s.title, position: idx, level: 1 });
      idx += s.blocks.length;
    }
    if (items.length === 0 && (sections?.length ?? 0) > 0) {
      flatTexts.forEach((p, pIdx) => {
        const line = p.split('\n')[0].trim();
        if (line.length <= 32 && CHAPTER_RE.test(line)) {
          items.push({ title: line, position: pIdx, level: 1 });
        }
      });
    }
    return items;
  }, [epub, sections, flatTexts]);

  const chapterForIndex = React.useCallback(
    (pIdx: number): string => {
      let name = '';
      for (const t of toc) {
        if (t.position <= pIdx) name = t.title;
        else break;
      }
      return name;
    },
    [toc]
  );

  const saveProgress = React.useCallback(
    (pct: number) => {
      if (!bookId || !window.electronAPI) return;
      // 页数以**实测分页**为准（一列 = 一页），与阅读页底部「共 n 页」同源。
      // 导入时那个 字数/1000 的估算只在首次打开前顶着（DDIA 估 507 页、实测 127 页，
      // 书库显示「剩余 499 页」而阅读页显示「共 128 页」就是这两套口径打起来了）。
      const info = dualPagerRef.current?.getPageInfo();
      const fallbackTotal = book?.totalPages || Math.ceil(totalChars / 1000) || 1;
      const totalPages = info && info.pages > 0 ? info.pages : fallbackTotal;
      const currentPage =
        info && info.pages > 0
          ? info.firstPage
          : Math.max(1, Math.ceil((pct / 100) * totalPages));
      // 附带正文锚点：改字号重排/重新打开时按内容位置精确恢复（而非按比例跳变）
      const anchor = dualPagerRef.current?.getAnchor() ?? undefined;
      window.electronAPI.books.updateProgress(bookId, Math.round(pct), currentPage, anchor, totalPages);
      qc.setQueryData<Book[]>(BOOKS_QUERY_KEY, (old) =>
        old?.map((b) =>
          b.id === bookId
            ? {
                ...b,
                readingProgress: Math.round(pct),
                currentPage,
                totalPages,
                lastRead: new Date().toISOString(),
              }
            : b
        )
      );
    },
    [bookId, book?.totalPages, totalChars, qc]
  );

  React.useEffect(() => {
    if (!sections && !epub) return;
    const t = window.setTimeout(() => saveProgress(progressRef.current), 1200);
    return () => window.clearTimeout(t);
  }, [progressPct, sections, epub, saveProgress]);

  // ---------- 退出阅读页面（先落盘进度再返回书库） ----------
  const exitReader = React.useCallback(() => {
    saveProgress(progressRef.current);
    navigate('/');
  }, [saveProgress, navigate]);

  // ---------- 翻页与进度回报 ----------
  const routePage = React.useCallback((dir: 1 | -1) => {
    const pager = dualPagerRef.current;
    pager?.[dir > 0 ? 'next' : 'prev']();
  }, []);

  const handlePagerProgress = React.useCallback(
    (page: number, total: number) => {
      const pct = total > 0 ? ((page + 1) / total) * 100 : 0;
      progressRef.current = pct;
      setProgressPct(pct);
      // 按百分比估算当前文本单元 → 推断章节名（目录高亮 / 书签标注用）
      const estIdx = Math.max(
        0,
        Math.min(flatTexts.length - 1, Math.round((pct / 100) * flatTexts.length))
      );
      setCurrentChapter(chapterForIndex(estIdx));
    },
    [flatTexts, chapterForIndex]
  );

  // ---------- 跳转（目录/书签/批注/搜索共用） ----------
  /** TXT：块索引 → 页；EPUB：章索引 → 页 */
  const jumpToUnit = React.useCallback(
    (idx: number) => {
      const selector = epub ? `[data-chidx="${idx}"]` : `[data-pidx="${idx}"]`;
      dualPagerRef.current?.goToElement(selector);
      window.setTimeout(() => {
        const p = document.querySelector<HTMLElement>(selector);
        if (p) {
          p.classList.add('highlight-pulse');
          window.setTimeout(() => p.classList.remove('highlight-pulse'), 2000);
        }
      }, 60);
    },
    [epub]
  );

  const jumpToPercent = React.useCallback((pct: number) => {
    dualPagerRef.current?.goToPercent(pct);
  }, []);

  /** EPUB：章内字符偏移定位（划线/搜索命中） */
  const jumpToTextOffset = React.useCallback((chidx: number, offset: number) => {
    dualPagerRef.current?.goToTextOffset(`[data-chidx="${chidx}"]`, offset);
  }, []);

  const jumpToNote = React.useCallback(
    (n: Note) => {
      if (n.chidx != null && n.start != null) {
        jumpToTextOffset(n.chidx, n.start);
        return;
      }
      if (n.pidx != null) jumpToUnit(n.pidx);
      else jumpToPercent(n.position);
    },
    [jumpToTextOffset, jumpToUnit, jumpToPercent]
  );

  /** 书内点击：图片 → 全图查看；data-book-link → 章节跳转；data-external-href → 系统浏览器 */
  const handleBookLinkClick = React.useCallback(
    (e: React.MouseEvent) => {
      const target = e.target as HTMLElement;
      const img = target.closest('img');
      if (img) {
        const src = img.getAttribute('src') ?? img.currentSrc ?? '';
        if (src && /^(bookres:|data:|https?:)/i.test(src)) {
          e.preventDefault();
          e.stopPropagation();
          setLightbox({ src, alt: img.getAttribute('alt') ?? '' });
          return;
        }
      }
      const a = target.closest('a');
      if (!a) return;
      e.preventDefault();
      e.stopPropagation();
      const external = a.getAttribute('data-external-href');
      if (external) {
        window.electronAPI?.app.openExternal(external).catch(() => {});
        return;
      }
      const link = a.getAttribute('data-book-link');
      if (!link) return;
      const targetChapter = epub?.chapters.find((c) => c.zipPath === link);
      if (targetChapter) jumpToUnit(targetChapter.chidx);
    },
    [epub, jumpToUnit]
  );

  /** 正文单击：命中划线/批注高亮 → 弹出该条批注阅览（选区/图片/链接场景除外） */
  const handleContentClick = React.useCallback(
    (e: React.MouseEvent) => {
      if (e.defaultPrevented) return; // 图片/链接已处理
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.toString()) return; // 选词操作优先
      const target = e.target as HTMLElement;
      if (target.closest('img, a, svg, [data-no-annotation]')) return;
      const unit = target.closest<HTMLElement>('[data-pidx], [data-chidx]');
      if (!unit) return;
      const pidx = unit.dataset.pidx != null ? Number(unit.dataset.pidx) : null;
      const chidx = unit.dataset.chidx != null ? Number(unit.dataset.chidx) : null;
      const offset = textOffsetFromPoint(e.clientX, e.clientY, unit);
      if (offset < 0) return;
      const hit = (book?.notes ?? []).find(
        (n) =>
          n.start != null &&
          n.end != null &&
          n.end > n.start &&
          offset >= n.start &&
          offset < n.end &&
          ((pidx != null && n.pidx === pidx) || (chidx != null && n.chidx === chidx))
      );
      if (!hit) return;
      setNotePopup({ note: hit, x: e.clientX, y: e.clientY });
    },
    [book?.notes]
  );

  const closeNotePopup = React.useCallback(() => setNotePopup(null), []);

  /** 弹层内编辑保存：只改 content（定位区间不可改，防止与正文高亮错位） */
  const savePopupNote = React.useCallback(
    async (note: Note, content: string) => {
      setNotePopup(null);
      if (!book || !window.electronAPI?.notes.update) return;
      const res = await window.electronAPI.notes.update({
        bookId: book.id,
        noteId: note.id,
        patch: { content },
      });
      if (res.success && res.note) {
        qc.setQueryData<Book[]>(BOOKS_QUERY_KEY, (old) =>
          old?.map((b) =>
            b.id === book.id
              ? {
                  ...b,
                  notes: (b.notes ?? []).map((n) => (n.id === note.id ? res.note! : n)),
                }
              : b
          )
        );
      }
      refreshBookData();
    },
    [book, qc, refreshBookData]
  );

  const deletePopupNote = React.useCallback(
    async (note: Note) => {
      setNotePopup(null);
      if (!book || !window.electronAPI) return;
      await window.electronAPI.notes.remove({ bookId: book.id, noteId: note.id });
      refreshBookData();
    },
    [book, refreshBookData]
  );

  // ---------- EPUB 划线高亮（CSS Custom Highlight API，按颜色注册） ----------
  React.useEffect(() => {
    const registry = (CSS as unknown as { highlights?: Map<string, unknown> }).highlights;
    const HighlightCtor = (
      window as unknown as { Highlight?: new (...ranges: Range[]) => unknown }
    ).Highlight;
    if (!registry || !HighlightCtor) return;

    registry.clear();
    if (!epub) return;
    const byColor = new Map<string, Range[]>();
    for (const n of book?.notes ?? []) {
      if (n.chidx == null || n.start == null || n.end == null || n.end <= n.start) continue;
      const root = document.querySelector<HTMLElement>(`[data-chidx="${n.chidx}"]`);
      if (!root) continue;
      for (const r of collectTextRanges(root, n.start, n.end)) {
        const arr = byColor.get(n.color) ?? [];
        arr.push(r);
        byColor.set(n.color, arr);
      }
    }
    for (const [color, ranges] of byColor) {
      const idx = ANNOTATION_COLORS.findIndex(
        (c) => c.value.toLowerCase() === color.toLowerCase()
      );
      registry.set(`note-hl-${idx >= 0 ? idx : 'x'}`, new HighlightCtor(...ranges));
    }
    return () => {
      registry.clear();
    };
  }, [epub, book?.notes, coverUrl]);

  // ---------- 键盘 ----------
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      // 批注弹层内 Esc 关闭（textarea 也在其内，需在输入控件豁免前处理）
      if (e.key === 'Escape' && notePopup) {
        e.preventDefault();
        setNotePopup(null);
        return;
      }
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        routePage(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        routePage(1);
      } else if (e.key === 'Escape') {
        if (lightbox) setLightbox(null);
        else if (notePopup) setNotePopup(null);
        else if (noteDraft) setNoteDraft(null);
        else if (selectionPopup) setSelectionPopup(null);
        else if (activeModal) setActiveModal(null);
        else if (searchOpen) setSearchOpen(false);
        else exitReader();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    routePage,
    lightbox,
    notePopup,
    noteDraft,
    selectionPopup,
    activeModal,
    searchOpen,
    exitReader,
  ]);

  // ---------- 书签 ----------
  const toggleBookmark = React.useCallback(async () => {
    if (!book || !window.electronAPI) return;
    const existing = book.bookmarks.find(
      (bm) => Math.abs(bm.position - progressRef.current) < 1
    );
    if (existing) {
      await window.electronAPI.bookmarks.remove({
        bookId: book.id,
        bookmarkId: existing.id,
      });
    } else {
      await window.electronAPI.bookmarks.add({
        bookId: book.id,
        position: Math.round(progressRef.current),
        chapter: currentChapter,
      });
    }
    refreshBookData();
  }, [book, currentChapter, refreshBookData]);

  const deleteBookmark = React.useCallback(
    async (bm: Bookmark) => {
      if (!book || !window.electronAPI) return;
      await window.electronAPI.bookmarks.remove({ bookId: book.id, bookmarkId: bm.id });
      refreshBookData();
    },
    [book, refreshBookData]
  );

  // ---------- 选区 → 划线 / 批注 ----------
  const onArticleMouseUp = React.useCallback((e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest?.('[data-no-annotation]')) return;
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!sel || !text || text.length < 2) return;
    // TXT 按段落取偏移；EPUB 原书渲染按整章文本取偏移
    const info = epub ? getSelectionRangeByChapter() : getSelectionRange();
    const rect = info?.rect ?? sel.getRangeAt(0).getBoundingClientRect();
    setSelectionPopup({
      x: Math.min(rect.left + rect.width / 2, window.innerWidth - 140),
      y: rect.bottom + 6,
      quote: text.slice(0, 80),
      range: info
        ? epub
          ? { chidx: info.anchorIndex, start: info.start, end: info.end }
          : { pidx: info.anchorIndex, start: info.start, end: info.end }
        : null,
    });
  }, [epub]);

  /** 以当前色板颜色划线（持久化后在正文中渲染） */
  const addUnderline = React.useCallback(async () => {
    if (!selectionPopup?.range || !book || !window.electronAPI) return;
    const r = selectionPopup.range;
    await window.electronAPI.notes.add({
      bookId: book.id,
      note: {
        type: 'underline',
        quote: selectionPopup.quote,
        content: '',
        color: popupColor,
        position: Math.round(progressRef.current),
        ...(r.pidx != null ? { pidx: r.pidx } : {}),
        ...(r.chidx != null ? { chidx: r.chidx } : {}),
        start: r.start,
        end: r.end,
      },
    });
    setSelectionPopup(null);
    window.getSelection()?.removeAllRanges();
    refreshBookData();
  }, [selectionPopup, popupColor, book, refreshBookData]);

  const openNoteDraft = React.useCallback(() => {
    if (!selectionPopup) return;
    setNoteDraft({
      quote: selectionPopup.quote,
      content: '',
      color: popupColor,
      range: selectionPopup.range,
    });
    setSelectionPopup(null);
  }, [selectionPopup, popupColor]);

  const saveNote = React.useCallback(async () => {
    if (!noteDraft || !book || !window.electronAPI) return;
    await window.electronAPI.notes.add({
      bookId: book.id,
      note: {
        type: 'note',
        quote: noteDraft.quote,
        content: noteDraft.content,
        color: noteDraft.color,
        position: Math.round(progressRef.current),
        ...(noteDraft.range
          ? {
              ...(noteDraft.range.pidx != null ? { pidx: noteDraft.range.pidx } : {}),
              ...(noteDraft.range.chidx != null ? { chidx: noteDraft.range.chidx } : {}),
              start: noteDraft.range.start,
              end: noteDraft.range.end,
            }
          : {}),
      },
    });
    setNoteDraft(null);
    window.getSelection()?.removeAllRanges();
    refreshBookData();
  }, [noteDraft, book, refreshBookData]);

  const removeNote = React.useCallback(
    async (note: Note) => {
      if (!book || !window.electronAPI) return;
      await window.electronAPI.notes.remove({ bookId: book.id, noteId: note.id });
      refreshBookData();
    },
    [book, refreshBookData]
  );

  // ---------- 渲染辅助 ----------
  const articleStyle: React.CSSProperties = {
    fontSize: `${prefs.fontSize}px`,
    lineHeight: prefs.lineHeight,
    letterSpacing: `${prefs.letterSpacing}em`,
    fontFamily: resolveFontFamily(prefs.fontFamily),
  };

  /** 划线切段渲染：着色段包 span；allowMarkup 时再做行内富文本（链接/加粗） */
  const renderSegments = (segs: TextSegment[], allowMarkup: boolean) =>
    segs.map((seg, si) => {
      const content = allowMarkup ? renderInlineMarkup(seg.text) : seg.text;
      return seg.color ? (
        <span
          key={si}
          style={{
            backgroundColor: `${seg.color}26`,
            boxShadow: `inset 0 -2px ${seg.color}`,
          }}
        >
          {content}
        </span>
      ) : (
        <React.Fragment key={si}>{content}</React.Fragment>
      );
    });

  /**
   * 正文块渲染：
   * - title  → .reader-chapter-title（章标题，加粗居中，break-before 分页）；
   * - heading → .reader-heading（文内小标题，加粗、按级别缩放，不分页）；
   * - pre    → .reader-code-block（等宽、保留换行缩进；不做链接解析）；
   * - para   → 普通段落（缩进 + 行内富文本）。
   * 前三者均支持划线区间着色。
   */
  const renderBlocks = (list: ReaderBlock[]) =>
    list.map((b, i) => {
      if (b.kind === 'title') {
        return (
          <h2 key={`title-${i}`} className="reader-chapter-title">
            {b.text}
          </h2>
        );
      }

      const ranges = underlineRangesByPidx.get(b.pidx ?? -1);
      const segs: TextSegment[] = ranges?.length
        ? segmentParagraph(b.text, ranges)
        : [{ text: b.text }];

      if (b.kind === 'heading') {
        const em =
          b.level === 1 ? 1.4 : b.level === 2 ? 1.28 : b.level === 3 ? 1.16 : b.level === 4 ? 1.08 : 1;
        return (
          <h3
            key={b.pidx}
            data-pidx={b.pidx}
            data-anchor={b.pidx}
            className="reader-heading"
            style={{ fontSize: `${em}em` }}
          >
            {renderSegments(segs, true)}
          </h3>
        );
      }
      if (b.kind === 'pre') {
        return (
          <pre key={b.pidx} data-pidx={b.pidx} data-anchor={b.pidx} className="reader-code-block">
            {renderSegments(segs, false)}
          </pre>
        );
      }
      return (
        <p key={b.pidx} data-pidx={b.pidx} data-anchor={b.pidx} className="mb-6 indent-[2em]">
          {renderSegments(segs, true)}
        </p>
      );
    });

  // ---------- 各状态渲染 ----------
  if (bookLoading && !book) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  if (!book) {
    return (
      <CenterNotice title="书籍不存在" description="它可能已被删除。">
        <Button variant="outline" onClick={() => navigate('/')}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          返回书库
        </Button>
      </CenterNotice>
    );
  }

  if (loadError) {
    return (
      <CenterNotice title="读取失败" description={loadError}>
        <Button variant="outline" onClick={() => navigate('/')}>
          返回书库
        </Button>
      </CenterNotice>
    );
  }

  if (unsupportedFormat) {
    return (
      <CenterNotice
        title={`${unsupportedFormat} 格式阅读开发中`}
        description="目前支持 TXT 正文的完整阅读，其他格式敬请期待后续版本。"
      >
        <Button onClick={() => navigate('/')}>
          <ArrowLeft className="mr-1.5 h-4 w-4" />
          返回书库
        </Button>
      </CenterNotice>
    );
  }

  if (!sections && !epub) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <Spinner />
        <p className="text-xs text-muted-foreground">
          {buildProgress && buildProgress.total > 1
            ? `正在解析本书排版… ${buildProgress.done}/${buildProgress.total} 章`
            : '正在打开…'}
        </p>
      </div>
    );
  }

  /**
   * 正文内容：
   * - EPUB：封面页（首屏，来自封面抽取）+ 各章净化后的原始 XHTML（原书 CSS 生效）；
   * - TXT：文本块渲染管线（章标题/文内标题/代码块/段落 + 划线 span）。
   */
  const content = epub ? (
    <>
      {coverUrl && (
        <div className="reader-cover-page">
          <img src={coverUrl} alt={book.title} draggable={false} />
        </div>
      )}
      {epub.chapters
        .filter((c) => c.html)
        .map((c) =>
          c.chidx === duplicateCoverChidx ? (
            // 原书自带的纯封面图页与上面抽取出的封面重复（且 calibre 的
            // preserveAspectRatio="none" 会把它拉变形）：保留占位节点让 data-chidx
            // 编号与跳转选择器不变，但不渲染内容（display:none 不生成列，不留空白页）
            <section
              key={c.chidx}
              data-chidx={c.chidx}
              className="epub-chapter"
              style={{ display: 'none' }}
            />
          ) : (
            <section
              key={c.chidx}
              data-chidx={c.chidx}
              data-anchor={c.chidx}
              className="epub-chapter"
              onClick={handleBookLinkClick}
            >
              {c.css ? <style>{c.css}</style> : null}
              <div className="epub-body" dangerouslySetInnerHTML={{ __html: c.html }} />
            </section>
          )
        )}
    </>
  ) : (
    <>{renderBlocks(blocks)}</>
  );

  return (
    <>
      {/* 共享书 CSS（去重、全局作用域一次）+ 用户排版兜底 + 划线高亮伪类 */}
      {epub?.sharedCss ? <style>{epub.sharedCss}</style> : null}
      <style>{readerTypographyCss(prefs)}</style>
      <style>{HIGHLIGHT_CSS}</style>

      {/* 双页阅读视图（唯一阅读模式） */}
      <DualPageView
        ref={dualPagerRef}
        content={content}
        contentId="book-flow"
        articleStyle={articleStyle}
        layoutDeps={
          epub
            ? [epub, coverUrl, prefs.fontSize, prefs.lineHeight, prefs.letterSpacing, prefs.fontFamily]
            : [blocks, prefs.fontSize, prefs.lineHeight, prefs.letterSpacing]
        }
        initialPercent={book.readingProgress || 0}
        initialAnchor={book.readingAnchor ?? null}
        onPageChange={handlePagerProgress}
        onExit={exitReader}
        onIncreaseFont={() => setFontSize(prefs.fontSize + FONT_SIZE_STEP)}
        onDecreaseFont={() => setFontSize(prefs.fontSize - FONT_SIZE_STEP)}
        onToggleBookmark={toggleBookmark}
        isBookmarked={isBookmarked}
        onOpenSearch={() => setSearchOpen(true)}
        onOpenToc={() => setActiveModal('toc')}
        onOpenBookmarks={() => setActiveModal('bookmarks')}
        onOpenNotes={() => setActiveModal('notes')}
        onArticleMouseUp={onArticleMouseUp}
        onContentClick={handleContentClick}
      />

      {/* 目录 / 书签 / 我的批注 弹窗 */}
      <TocModal
        open={activeModal === 'toc'}
        onClose={() => setActiveModal(null)}
        toc={toc}
        currentChapter={currentChapter}
        onJumpToParagraph={jumpToUnit}
      />
      <BookmarksModal
        open={activeModal === 'bookmarks'}
        onClose={() => setActiveModal(null)}
        bookmarks={book.bookmarks ?? []}
        onJumpToPercent={jumpToPercent}
        onDelete={deleteBookmark}
      />
      <NotesModal
        open={activeModal === 'notes'}
        onClose={() => setActiveModal(null)}
        notes={book.notes ?? []}
        onJumpToNote={jumpToNote}
        onDelete={removeNote}
      />

      {/* 选区操作条：色板 + 划线 / 批注 */}
      {selectionPopup && (
        <>
          <div
            className="fixed inset-0 z-[1200]"
            onMouseDown={() => setSelectionPopup(null)}
          />
          <div
            className="fixed z-[1300] flex flex-col gap-2 rounded-xl border border-border bg-popover text-popover-foreground shadow-xl p-2.5"
            style={{
              left: Math.max(8, Math.min(selectionPopup.x - 112, window.innerWidth - 240)),
              top: Math.min(selectionPopup.y, window.innerHeight - 110),
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-center gap-1.5">
              {ANNOTATION_COLORS.map((c) => (
                <button
                  key={c.value}
                  title={c.label}
                  className={cn(
                    'w-4 h-4 rounded-full transition-shadow',
                    popupColor === c.value && 'ring-2 ring-ring ring-offset-1 ring-offset-popover'
                  )}
                  style={{ background: c.value }}
                  onClick={() => setPopupColor(c.value)}
                />
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <button
                className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs hover:bg-accent hover:text-accent-foreground transition-colors disabled:opacity-40 disabled:pointer-events-none"
                title={selectionPopup.range ? '以此颜色划线' : '跨段选区仅支持批注'}
                disabled={!selectionPopup.range}
                onClick={addUnderline}
              >
                <Highlighter className="h-3.5 w-3.5" />
                划线
              </button>
              <button
                className="flex items-center gap-1 px-3 py-1.5 rounded-md text-xs hover:bg-accent hover:text-accent-foreground transition-colors"
                onClick={openNoteDraft}
              >
                <StickyNote className="h-3.5 w-3.5" />
                批注
              </button>
            </div>
          </div>
        </>
      )}

      {/* 批注编辑框 */}
      {noteDraft && (
        <div
          className="fixed inset-0 z-[1400] bg-black/40 flex items-center justify-center"
          onMouseDown={() => setNoteDraft(null)}
        >
          <div
            className="w-96 max-w-[90vw] rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl p-4 space-y-3"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <p className="text-xs text-muted-foreground italic line-clamp-2">
              "{noteDraft.quote}"
            </p>
            <textarea
              autoFocus
              value={noteDraft.content}
              onChange={(e) => setNoteDraft({ ...noteDraft, content: e.target.value })}
              placeholder="写下你的想法..."
              rows={3}
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
            />
            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                {ANNOTATION_COLORS.map((c) => (
                  <button
                    key={c.value}
                    title={c.label}
                    className={cn(
                      'w-5 h-5 rounded-full ring-offset-2 ring-offset-background transition-shadow',
                      noteDraft.color === c.value && 'ring-2 ring-ring'
                    )}
                    style={{ background: c.value }}
                    onClick={() => setNoteDraft({ ...noteDraft, color: c.value })}
                  />
                ))}
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" onClick={() => setNoteDraft(null)}>
                  取消
                </Button>
                <Button size="sm" disabled={!noteDraft.content.trim()} onClick={saveNote}>
                  保存批注
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      <SearchModal
        open={searchOpen}
        onClose={() => setSearchOpen(false)}
        paragraphs={flatTexts}
        onJumpTo={(idx, matchOffset) => {
          if (epub) jumpToTextOffset(idx, matchOffset);
          else jumpToUnit(idx);
        }}
      />

      {/* 全图查看弹窗：点击正文图片打开；滚轮缩放、双击在 1x/2x 间切换、
          放大后可拖拽平移、底部按钮控制（+/−/复位/关闭） */}
      {lightbox && (
        <div
          className="fixed inset-0 z-[1600] bg-black/90 flex items-center justify-center select-none overflow-hidden"
          data-no-annotation
          onClick={(e) => {
            // 点击图片本身不关闭（拖拽误触），点空白处才关闭
            if (!(e.target as HTMLElement).closest('[data-lb-img]')) setLightbox(null);
          }}
          onWheel={(e) => {
            e.preventDefault();
            zoomBy(e.deltaY < 0 ? 1.2 : 1 / 1.2);
          }}
        >
          <img
            data-lb-img
            src={lightbox.src}
            alt={lightbox.alt}
            draggable={false}
            className={cn(
              'max-w-[94vw] max-h-[94vh] object-contain rounded-sm shadow-2xl',
              lbZoom > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in'
            )}
            style={{
              transform: `translate(${lbPan.x}px, ${lbPan.y}px) scale(${lbZoom})`,
              transition: lbDragRef.current ? 'none' : 'transform 0.15s ease-out',
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (lbDragRef.current?.moved) return; // 拖拽结束的 click 不算双击
              const next = lbZoom > 1 ? 1 : 2;
              setLbZoom(next);
              if (next === 1) setLbPan({ x: 0, y: 0 });
            }}
            onDoubleClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => {
              if (lbZoom <= 1) return;
              lbDragRef.current = { sx: e.clientX, sy: e.clientY, px: lbPan.x, py: lbPan.y, moved: false };
            }}
            onMouseMove={(e) => {
              const d = lbDragRef.current;
              if (!d) return;
              if (Math.abs(e.clientX - d.sx) + Math.abs(e.clientY - d.sy) > 4) d.moved = true;
              setLbPan({ x: d.px + e.clientX - d.sx, y: d.py + e.clientY - d.sy });
            }}
            onMouseUp={() => {
              window.setTimeout(() => {
                lbDragRef.current = null;
              }, 0);
            }}
            onMouseLeave={() => {
              lbDragRef.current = null;
            }}
          />

          {/* 缩放控制条 + 缩放比例 */}
          <div
            className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-black/60 text-white px-2 py-1.5 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <LbBtn title="缩小" onClick={() => zoomBy(1 / 1.25)} disabled={lbZoom <= 0.25}>
              <Minus className="h-4 w-4" />
            </LbBtn>
            <span className="w-14 text-center text-xs tabular-nums">
              {Math.round(lbZoom * 100)}%
            </span>
            <LbBtn title="放大" onClick={() => zoomBy(1.25)} disabled={lbZoom >= 6}>
              <Plus className="h-4 w-4" />
            </LbBtn>
            <span className="w-px h-5 bg-white/30 mx-1" />
            <LbBtn title="复位（1:1 适配窗口）" onClick={resetLbView} disabled={lbZoom === 1 && lbPan.x === 0 && lbPan.y === 0}>
              <Maximize className="h-4 w-4" />
            </LbBtn>
            <LbBtn title="关闭（Esc）" onClick={() => setLightbox(null)}>
              <X className="h-4 w-4" />
            </LbBtn>
          </div>
        </div>
      )}

      {/* 批注阅览/编辑弹层：点击正文中的划线/批注高亮弹出 */}
      {notePopup && (
        <NotePopup
          note={notePopup.note}
          x={notePopup.x}
          y={notePopup.y}
          onClose={closeNotePopup}
          onSave={savePopupNote}
          onDelete={deletePopupNote}
        />
      )}
    </>
  );
}

// ========================================
// 小组件
// ========================================

function Spinner() {
  return (
    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
  );
}

/** 全图弹窗底部的圆形控制按钮 */
function LbBtn({
  children,
  title,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      onMouseDown={(e) => e.stopPropagation()}
      className={cn(
        'w-9 h-9 rounded-full flex items-center justify-center transition-colors',
        'hover:bg-white/20 disabled:opacity-30 disabled:pointer-events-none'
      )}
    >
      {children}
    </button>
  );
}

/** 批注阅览/编辑弹层：引用 + 可编辑批注内容 + 颜色条；
 * 点击弹窗外部任意处关闭（有未保存修改时也直接关闭），保存/删除为图标按钮 */
function NotePopup({
  note,
  x,
  y,
  onClose,
  onSave,
  onDelete,
}: {
  note: Note;
  x: number;
  y: number;
  onClose: () => void;
  onSave: (note: Note, content: string) => void;
  onDelete: (note: Note) => void;
}) {
  const [draft, setDraft] = React.useState(note.content ?? '');
  const W = 320;
  const left = Math.max(12, Math.min(x - W / 2, window.innerWidth - W - 12));
  const below = y + 12;
  const estH = 170 + Math.min(note.quote?.length ?? 0, 90) * 0.6;
  const top = below + estH < window.innerHeight - 12 ? below : Math.max(12, y - estH - 24);

  return (
    <>
      <div className="fixed inset-0 z-[1500]" onMouseDown={onClose} />
      <div
        data-no-annotation
        className="fixed z-[1510] rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl p-3.5"
        style={{ left, top, width: W }}
      >
        <div className="flex items-start gap-2 mb-2">
          <span
            className="mt-0.5 w-2.5 h-2.5 rounded-full shrink-0"
            style={{ background: note.color }}
          />
          <p className="text-xs text-muted-foreground italic leading-5 line-clamp-3">
            "{note.quote}"
          </p>
        </div>
        <textarea
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && draft.trim() && draft !== note.content) {
              e.preventDefault();
              onSave(note, draft);
            }
          }}
          placeholder="写下你的想法..."
          rows={3}
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm leading-6 outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
        />
        <div className="flex items-center justify-end gap-1 mt-2.5">
          <button
            title={draft.trim() && draft !== note.content ? '保存修改' : '内容未变化'}
            disabled={!draft.trim() || draft === note.content}
            onClick={() => onSave(note, draft)}
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground disabled:opacity-30 disabled:pointer-events-none"
          >
            <Check className="h-4 w-4" />
          </button>
          <button
            title="删除"
            onClick={() => onDelete(note)}
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </>
  );
}

function CenterNotice({
  title,
  description,
  children,
}: {
  title: string;
  description?: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="h-full flex items-center justify-center p-8">
      <div className="text-center space-y-3 max-w-sm">
        <h2 className="text-xl font-bold">{title}</h2>
        {description && <p className="text-sm text-muted-foreground">{description}</p>}
        <div className="pt-2 flex justify-center">{children}</div>
      </div>
    </div>
  );
}
