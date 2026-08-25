/**
 * ReaderPage - 阅读页
 * 对应设计稿 .backup/read.html（标准）、immersive.html（沉浸）、dual-page.html（双页）
 * 功能：TOC、滚动进度、字号、主题循环、书签、批注、搜索、键盘翻页
 */

import * as React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useTheme } from '@/components/theme-provider';
import {
  ArrowLeft,
  Baseline,
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Layers,
  Moon,
  Search,
  StickyNote,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SearchModal } from '@/components/reader/SearchModal';
import { ImmersiveView } from '@/components/reader/ImmersiveView';
import { DualPageView } from '@/components/reader/DualPageView';
import {
  ANNOTATION_COLORS,
  FONT_SIZE_STEP,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
} from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useBook, BOOKS_QUERY_KEY } from '@/hooks/useBooks';
import type { PagerHandle } from '@/hooks/useColumnPagination';
import type { Book, Note, TocItem } from '@/lib/types';

const READER_PREFS_KEY = 'sun-reader-settings';
const CHAPTER_RE =
  /^(第\s*[一二三四五六七八九十百千万零〇\d]+\s*[章节回卷部集]|序章|序言|前言|引子|尾声|后记|番外|楔子).{0,30}$/;

interface Prefs {
  fontSize: number;
  lineHeight: number;
}

function clampFont(size: number): number {
  return Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, size));
}

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(READER_PREFS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      return { fontSize: clampFont(p.fontSize ?? 21), lineHeight: p.lineHeight ?? 1.9 };
    }
  } catch {
    /* ignore */
  }
  return { fontSize: 21, lineHeight: 1.9 };
}

export function ReaderPage() {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { theme, setTheme } = useTheme();
  const { data: book, isLoading: bookLoading } = useBook(bookId);

  // ---------- 内容状态 ----------
  interface Section {
    title: string;
    paragraphs: string[];
  }
  const [sections, setSections] = React.useState<Section[] | null>(null);
  const [unsupportedFormat, setUnsupportedFormat] = React.useState<string | null>(null);
  const [loadError, setLoadError] = React.useState<string | null>(null);

  // ---------- 阅读设置 ----------
  const [prefs, setPrefs] = React.useState<Prefs>(loadPrefs);
  const setFontSize = (size: number) =>
    setPrefs((p) => {
      const next = { ...p, fontSize: clampFont(size) };
      try {
        localStorage.setItem(READER_PREFS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });

  // ---------- 阅读位置 ----------
  const [progressPct, setProgressPct] = React.useState(0);
  const [currentChapter, setCurrentChapter] = React.useState('');
  const [searchOpen, setSearchOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const restoredRef = React.useRef(false);
  const progressRef = React.useRef(0);
  // 沉浸/双页分页器句柄（键盘统一从这里路由）
  const immersivePagerRef = React.useRef<PagerHandle>(null);
  const dualPagerRef = React.useRef<PagerHandle>(null);

  // ---------- 视图模式 ----------
  const [viewMode, setViewMode] = React.useState<'standard' | 'immersive' | 'dual'>('standard');

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

  // ---------- 批注 ----------
  const [selectionPopup, setSelectionPopup] = React.useState<
    { x: number; y: number; quote: string } | null
  >(null);
  const [noteDraft, setNoteDraft] = React.useState<{
    quote: string;
    content: string;
    color: string;
  } | null>(null);

  // ---------- 内容加载 ----------
  React.useEffect(() => {
    let cancelled = false;
    setSections(null);
    setLoadError(null);
    setUnsupportedFormat(null);
    setProgressPct(0);
    setCurrentChapter('');
    progressRef.current = 0;
    restoredRef.current = false;

    if (!bookId || !window.electronAPI) return;
    window.electronAPI.books.readContent(bookId).then((res) => {
      if (cancelled) return;
      if (!res.success) {
        setLoadError(res.error ?? '读取失败');
        return;
      }
      const fmt = (res.format ?? '').toLowerCase();

      if (fmt === 'epub' && res.chapters?.length) {
        setSections(res.chapters.map((c) => ({ title: c.title, paragraphs: c.paragraphs })));
        return;
      }
      if (fmt === 'txt') {
        setSections([
          {
            title: '',
            paragraphs: (res.content ?? '')
              .split(/\r?\n+/)
              .map((s) => s.trim())
              .filter(Boolean),
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

  /** 展平的全部段落（全局索引供搜索/跳转/双页使用） */
  const flatParagraphs = React.useMemo(
    () => sections?.flatMap((s) => s.paragraphs) ?? [],
    [sections]
  );

  /** 全文字符数（估算页数用） */
  const totalChars = React.useMemo(
    () => flatParagraphs.join('').length,
    [flatParagraphs]
  );

  /**
   * 目录：多节（EPUB）按节边界生成；单节（TXT）回退正则识别章节标题
   */
  const toc: TocItem[] = React.useMemo(() => {
    const items: TocItem[] = [];
    let idx = 0;
    for (const s of sections ?? []) {
      if (s.title) items.push({ title: s.title, position: idx, level: 1 });
      idx += s.paragraphs.length;
    }
    if (items.length === 0 && (sections?.length ?? 0) > 0) {
      flatParagraphs.forEach((p, pIdx) => {
        const line = p.split('\n')[0].trim();
        if (line.length <= 32 && CHAPTER_RE.test(line)) {
          items.push({ title: line, position: pIdx, level: 1 });
        }
      });
    }
    return items;
  }, [sections, flatParagraphs]);

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

  const visibleIndexAtScroll = React.useCallback((scrollTop: number): number => {
    const container = scrollRef.current;
    if (!container) return 0;
    const ps = container.querySelectorAll<HTMLElement>('[data-pidx]');
    const target = scrollTop + container.clientHeight * 0.3;
    let best = 0;
    ps.forEach((el) => {
      if (el.offsetTop <= target) best = Number(el.dataset.pidx) || 0;
    });
    return best;
  }, []);

  // ---------- 进度：滚动监听 ----------
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || !sections || viewMode !== 'standard') return;

    let lastRun = 0;
    const onScroll = () => {
      const now = Date.now();
      if (now - lastRun < 150) return;
      lastRun = now;
      const sh = el.scrollHeight - el.clientHeight;
      const pct = sh > 0 ? Math.round((el.scrollTop / sh) * 10000) / 100 : 0;
      progressRef.current = pct;
      setProgressPct(pct);
      setCurrentChapter(chapterForIndex(visibleIndexAtScroll(el.scrollTop)));
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    // 挂载时先算一次初始进度
    onScroll();
    return () => el.removeEventListener('scroll', onScroll);
  }, [sections, viewMode, chapterForIndex, visibleIndexAtScroll]);

  // 恢复上次阅读位置（仅标准模式容器）
  React.useEffect(() => {
    const el = scrollRef.current;
    if (!el || !sections || viewMode !== 'standard' || restoredRef.current) return;
    const saved = book?.readingProgress ?? 0;
    if (saved > 0 && saved < 100) {
      requestAnimationFrame(() => {
        el.scrollTop = ((el.scrollHeight - el.clientHeight) * saved) / 100;
        restoredRef.current = true;
      });
    } else {
      restoredRef.current = true;
    }
  }, [sections, viewMode, book]);

  const saveProgress = React.useCallback(
    (pct: number) => {
      if (!bookId || !window.electronAPI) return;
      const totalPages = book?.totalPages || Math.ceil(totalChars / 1000) || 1;
      const currentPage = Math.max(1, Math.ceil((pct / 100) * totalPages));
      window.electronAPI.books.updateProgress(bookId, Math.round(pct), currentPage);
      qc.setQueryData<Book[]>(BOOKS_QUERY_KEY, (old) =>
        old?.map((b) =>
          b.id === bookId
            ? {
                ...b,
                readingProgress: Math.round(pct),
                currentPage,
                lastRead: new Date().toISOString(),
              }
            : b
        )
      );
    },
    [bookId, book?.totalPages, totalChars, qc]
  );

  React.useEffect(() => {
    if (!sections) return;
    const t = window.setTimeout(() => saveProgress(progressRef.current), 1200);
    return () => window.clearTimeout(t);
  }, [progressPct, sections, saveProgress]);

  // ---------- 翻页（按视图模式路由：标准=滚动，沉浸/双页=分页器） ----------
  const pageBy = React.useCallback((dir: 1 | -1) => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollBy({ top: dir * el.clientHeight * 0.9, behavior: 'smooth' });
  }, []);

  const routePage = React.useCallback(
    (dir: 1 | -1) => {
      if (viewMode === 'standard') {
        pageBy(dir);
        return;
      }
      const pager = viewMode === 'immersive' ? immersivePagerRef.current : dualPagerRef.current;
      pager?.[dir > 0 ? 'next' : 'prev']();
    },
    [viewMode, pageBy]
  );

  /** 沉浸/双页分页器的进度回报 */
  const handlePagerProgress = React.useCallback((page: number, total: number) => {
    const pct = total > 0 ? ((page + 1) / total) * 100 : 0;
    progressRef.current = pct;
    setProgressPct(pct);
  }, []);

  // ---------- 键盘 ----------
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
        e.preventDefault();
        routePage(-1);
      } else if (e.key === 'ArrowRight' || e.key === 'PageDown' || e.key === ' ') {
        e.preventDefault();
        routePage(1);
      } else if (e.key === 'Escape') {
        if (searchOpen) setSearchOpen(false);
        else if (viewMode !== 'standard') setViewMode('standard');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [routePage, searchOpen, viewMode]);

  // ---------- 跳转段落 ----------
  const jumpToParagraph = React.useCallback((idx: number) => {
    const p = document.querySelector<HTMLElement>(`[data-pidx="${idx}"]`);
    if (!p) return;
    p.scrollIntoView({ behavior: 'smooth', block: 'center' });
    p.classList.add('highlight-pulse');
    window.setTimeout(() => p.classList.remove('highlight-pulse'), 2000);
  }, []);

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

  // ---------- 批注 ----------
  const onMouseUpArticle = React.useCallback(() => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!sel || !text || text.length < 2) return;
    const rect = sel.getRangeAt(0).getBoundingClientRect();
    setSelectionPopup({
      x: Math.min(rect.left + rect.width / 2, window.innerWidth - 140),
      y: rect.bottom + 6,
      quote: text.slice(0, 80),
    });
  }, []);

  const saveNote = React.useCallback(async () => {
    if (!noteDraft || !book || !window.electronAPI) return;
    await window.electronAPI.notes.add({
      bookId: book.id,
      note: {
        quote: noteDraft.quote,
        content: noteDraft.content,
        color: noteDraft.color,
        position: Math.round(progressRef.current),
      },
    });
    setNoteDraft(null);
    setSelectionPopup(null);
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
    fontFamily: "Georgia, 'Noto Serif SC', 'Source Han Serif SC', 'SimSun', serif",
  };

  const renderParagraphs = (paras: string[], startIdx = 0) =>
    paras.map((text, i) => (
      <p key={startIdx + i} data-pidx={startIdx + i} className="mb-6 indent-[2em]">
        {text}
      </p>
    ));

  /** 正文：按节渲染，节标题作为分隔（EPUB 多章；TXT 单节无标题） */
  const articleBody = (
    <div className="max-w-3xl mx-auto px-8 pb-24" style={articleStyle}>
      {(sections ?? []).map((sec, si) => {
        const startIdx =
          sections!.slice(0, si).reduce((sum, s) => sum + s.paragraphs.length, 0);
        return (
          <section key={si}>
            {sec.title && (
              <h2
                data-section-title
                className="text-2xl font-bold text-center my-10 font-serif tracking-wide"
              >
                {sec.title}
              </h2>
            )}
            {renderParagraphs(sec.paragraphs, startIdx)}
          </section>
        );
      })}
    </div>
  );

  /** 沉浸模式正文渲染参数（分页组件内部自行布局） */

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

  if (!sections) {
    return (
      <div className="h-full flex items-center justify-center">
        <Spinner />
      </div>
    );
  }

  const searchModal = (
    <SearchModal
      open={searchOpen}
      onClose={() => setSearchOpen(false)}
      paragraphs={flatParagraphs}
      onJumpTo={(idx) => {
        if (viewMode !== 'standard') setViewMode('standard');
        setTimeout(() => jumpToParagraph(idx), 120);
      }}
    />
  );

  const viewSwitcher = (
    <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5">
      {(
        [
          { key: 'standard', icon: <Layers className="h-4 w-4" />, title: '普通阅读' },
          { key: 'immersive', icon: <Moon className="h-4 w-4" />, title: '沉浸模式' },
          { key: 'dual', icon: <Columns2 className="h-4 w-4" />, title: '双页模式' },
        ] as const
      ).map(({ key, icon, title }) => (
        <button
          key={key}
          title={title}
          onClick={() => setViewMode(key)}
          className={cn(
            'w-8 h-7 rounded-sm flex items-center justify-center transition-colors',
            viewMode === key
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          )}
        >
          {icon}
        </button>
      ))}
    </div>
  );

  // ============ 标准模式 ============
  if (viewMode === 'standard') {
    return (
      <div className="h-full flex flex-col min-w-0">
        {/* 顶栏 */}
        <header className="shrink-0 h-14 px-5 flex items-center gap-4 border-b border-border bg-card">
          <button
            title="返回书库"
            onClick={() => navigate('/')}
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate leading-tight">{book.title}</h2>
            <p className="text-xs text-muted-foreground truncate leading-tight">
              {currentChapter || toc[0]?.title || '正文'}
            </p>
          </div>
          <div className="flex-1" />
          <div className="hidden sm:flex items-center gap-3 w-56">
            <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-150"
                style={{ width: `${Math.min(100, progressPct)}%` }}
              />
            </div>
            <span className="text-xs tabular-nums text-muted-foreground w-10 text-right">
              {Math.round(progressPct)}%
            </span>
          </div>
          {viewSwitcher}
        </header>

        {/* 正文 + 右侧面板 */}
        <div className="flex-1 flex min-h-0">
          <div
            ref={scrollRef}
            data-reader-scroll
            className="flex-1 overflow-y-auto min-w-0"
            onMouseUp={onMouseUpArticle}
          >
            {articleBody}
          </div>

          <aside className="hidden lg:flex w-72 shrink-0 border-l border-border bg-card flex-col overflow-y-auto">
            {/* 目录 */}
            <section className="p-4 border-b border-border">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5" />
                目录
              </h3>
              {toc.length === 0 ? (
                <p className="text-xs text-muted-foreground py-2">未识别到章节结构</p>
              ) : (
                <ul className="space-y-0.5 max-h-60 overflow-y-auto">
                  {toc.map((t, i) => (
                    <li key={i}>
                      <button
                        className={cn(
                          'w-full text-left text-sm px-2.5 py-1.5 rounded-md truncate transition-colors',
                          currentChapter === t.title
                            ? 'bg-primary/10 text-primary font-medium'
                            : 'hover:bg-accent hover:text-accent-foreground'
                        )}
                        onClick={() => jumpToParagraph(t.position)}
                      >
                        {t.title}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* 书签 */}
            <section className="p-4 border-b border-border">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <Bookmark className="h-3.5 w-3.5" />
                书签 ({book.bookmarks?.length ?? 0})
              </h3>
              {(book.bookmarks?.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground py-1">暂无书签</p>
              ) : (
                <ul className="space-y-1">
                  {[...book.bookmarks]
                    .sort((a, b) => a.position - b.position)
                    .map((bm) => (
                      <li key={bm.id} className="group flex items-center gap-1">
                        <button
                          className="flex-1 text-left text-sm px-2.5 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors truncate"
                          title={bm.chapter || `第 ${bm.position}%`}
                          onClick={() => {
                            const el = scrollRef.current;
                            if (!el) return;
                            el.scrollTop =
                              ((el.scrollHeight - el.clientHeight) * bm.position) / 100;
                          }}
                        >
                          <span className="tabular-nums">{bm.position}%</span>
                          {bm.chapter && (
                            <span className="text-muted-foreground"> · {bm.chapter}</span>
                          )}
                        </button>
                        <button
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-1 transition-opacity"
                          title="删除书签"
                          onClick={async () => {
                            await window.electronAPI!.bookmarks.remove({
                              bookId: book.id,
                              bookmarkId: bm.id,
                            });
                            refreshBookData();
                          }}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    ))}
                </ul>
              )}
            </section>

            {/* 我的批注 */}
            <section className="p-4">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <StickyNote className="h-3.5 w-3.5" />
                我的批注 ({book.notes?.length ?? 0})
              </h3>
              {(book.notes?.length ?? 0) === 0 ? (
                <p className="text-xs text-muted-foreground leading-relaxed">
                  选中正文文字即可添加批注。
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {book.notes.map((n) => (
                    <li
                      key={n.id}
                      className="group relative rounded-lg border border-border p-2.5"
                    >
                      <p className="text-xs text-muted-foreground italic line-clamp-2 mb-1">
                        "{n.quote}"
                      </p>
                      <p className="text-sm leading-snug line-clamp-3">{n.content}</p>
                      <div className="flex items-center justify-between mt-1.5">
                        <span
                          className="w-2 h-2 rounded-full inline-block"
                          style={{ background: n.color }}
                        />
                        <button
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                          title="删除批注"
                          onClick={() => removeNote(n)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </aside>
        </div>

        {/* 底部工具栏 */}
        <footer className="shrink-0 h-12 px-4 flex items-center justify-between border-t border-border bg-card">
          <button
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            onClick={() => pageBy(-1)}
          >
            <ChevronLeft className="h-4 w-4" />
            上一页
          </button>

          <div className="flex items-center gap-1">
            <ToolBtn
              title={`字号 ${prefs.fontSize}px（左键增大 / 右键减小）`}
              onClick={() => setFontSize(prefs.fontSize + FONT_SIZE_STEP)}
              onContextMenu={(e) => {
                e.preventDefault();
                setFontSize(prefs.fontSize - FONT_SIZE_STEP);
              }}
            >
              <Baseline className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn
              title={`主题：${theme}（点击循环切换）`}
              onClick={() => {
                const themes: Array<'light' | 'dark' | 'sepia'> = ['light', 'dark', 'sepia'];
                setTheme(themes[(themes.indexOf(theme) + 1) % themes.length]);
              }}
            >
              <Moon className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn title="搜索正文" onClick={() => setSearchOpen(true)}>
              <Search className="h-4 w-4" />
            </ToolBtn>
            <ToolBtn
              title={isBookmarked ? '移除此处书签' : '在此处添加书签'}
              onClick={toggleBookmark}
              active={isBookmarked}
            >
              {isBookmarked ? (
                <BookmarkCheck className="h-4 w-4" />
              ) : (
                <Bookmark className="h-4 w-4" />
              )}
            </ToolBtn>
          </div>

          <button
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
            onClick={() => pageBy(1)}
          >
            下一页
            <ChevronRight className="h-4 w-4" />
          </button>
        </footer>

        {/* 选区弹层：添加批注入口 */}
        {selectionPopup && (
          <>
            <div
              className="fixed inset-0 z-[1200]"
              onMouseDown={() => setSelectionPopup(null)}
            />
            <button
              className="fixed z-[1300] flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-popover text-popover-foreground border border-border shadow-xl text-sm hover:border-primary transition-colors"
              style={{ left: selectionPopup.x - 44, top: selectionPopup.y }}
              onMouseDown={(e) => {
                e.stopPropagation();
                setNoteDraft({
                  quote: selectionPopup.quote,
                  content: '',
                  color: ANNOTATION_COLORS[0].value,
                });
                setSelectionPopup(null);
              }}
            >
              <StickyNote className="h-3.5 w-3.5" />
              添加批注
            </button>
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

        {searchModal}
      </div>
    );
  }

  // ============ 沉浸模式 ============
  if (viewMode === 'immersive') {
    return (
      <>
        <ImmersiveView
          ref={immersivePagerRef}
          paragraphs={flatParagraphs}
          renderParagraphs={renderParagraphs}
          articleStyle={articleStyle}
          layoutDeps={[flatParagraphs, prefs.fontSize, prefs.lineHeight]}
          initialPercent={progressPct || book.readingProgress || 0}
          onPageChange={handlePagerProgress}
          isBookmarked={isBookmarked}
          onExit={() => setViewMode('standard')}
          onIncreaseFont={() => setFontSize(prefs.fontSize + FONT_SIZE_STEP)}
          onDecreaseFont={() => setFontSize(prefs.fontSize - FONT_SIZE_STEP)}
          onToggleBookmark={toggleBookmark}
          onOpenSearch={() => setSearchOpen(true)}
        />
        {searchModal}
      </>
    );
  }

  // ============ 双页模式 ============
  return (
    <>
      <DualPageView
        ref={dualPagerRef}
        paragraphs={flatParagraphs}
        renderParagraphs={renderParagraphs}
        articleStyle={articleStyle}
        layoutDeps={[flatParagraphs, prefs.fontSize, prefs.lineHeight]}
        initialPercent={progressPct || book.readingProgress || 0}
        onPageChange={handlePagerProgress}
        onExit={() => setViewMode('standard')}
      />
      {searchModal}
    </>
  );
}

// ========================================
// 小组件
// ========================================

function ToolBtn({
  children,
  title,
  onClick,
  onContextMenu,
  active,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  active?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      onContextMenu={onContextMenu}
      className={cn(
        'w-9 h-9 rounded-full flex items-center justify-center transition-colors',
        active
          ? 'text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      )}
    >
      {children}
    </button>
  );
}

function Spinner() {
  return (
    <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
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
