/**
 * LibraryPage - 书库页
 * 对应设计稿 .backup/index.html：
 * 头部（导入/搜索）→ 继续阅读大卡片 → 最近添加网格 → 右侧统计面板
 */

import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpen,
  Play,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/components/ui/toast';
import {
  useBooks,
  useBookCover,
  useDeleteBook,
  useImportBooks,
  useSubscribeBooksImported,
} from '@/hooks/useBooks';
import { FORMAT_LABELS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import type { Book } from '@/lib/types';

/** 无封面时按标题生成确定性的渐变色 */
function coverGradient(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `linear-gradient(135deg, hsl(${hue}, 45%, 38%), hsl(${(hue + 40) % 360}, 55%, 26%))`;
}

/**
 * 封面图：EPUB 解析出的真实封面优先，缺失时回退标题首字渐变占位
 */
function CoverArt({ bookId, title, charClass }: { bookId: string; title: string; charClass: string }) {
  const { data } = useBookCover(bookId);
  if (data?.success && data.dataUrl) {
    return (
      <img
        src={data.dataUrl}
        alt={title}
        draggable={false}
        className="absolute inset-0 w-full h-full object-cover"
      />
    );
  }
  return (
    <span
      className={`absolute inset-0 flex items-center justify-center text-white/85 font-serif select-none ${charClass}`}
    >
      {title.slice(0, 1)}
    </span>
  );
}

function formatTime(iso: string | null): string {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} 天前`;
  return new Date(iso).toLocaleDateString('zh-CN');
}

export function LibraryPage() {
  const navigate = useNavigate();
  const { data: books = [], isLoading } = useBooks();
  const importBooks = useImportBooks();
  const deleteBook = useDeleteBook();
  useSubscribeBooksImported();

  const [search, setSearch] = React.useState('');

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q
      ? books.filter(
          (b) =>
            b.title.toLowerCase().includes(q) ||
            b.author.toLowerCase().includes(q)
        )
      : books;
    // 最近添加优先，其次最近阅读
    return [...list].sort((a, b) => {
      const ta = a.lastRead || a.addedDate;
      const tb = b.lastRead || b.addedDate;
      return tb.localeCompare(ta);
    });
  }, [books, search]);

  /** 继续阅读：最近有阅读记录的书籍 */
  const continueBook = React.useMemo(() => {
    const read = books
      .filter((b) => b.lastRead && b.readingProgress > 0)
      .sort((a, b) => b.lastRead!.localeCompare(a.lastRead!));
    return read[0] ?? null;
  }, [books]);

  const recentBooks = filtered;

  /** 统计数据 */
  const stats = React.useMemo(() => {
    const finished = books.filter((b) => b.readingProgress >= 100).length;
    const pagesRead = books.reduce(
      (sum, b) => sum + Math.max(0, b.currentPage || 0),
      0
    );
    const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
    const activeDays = new Set(
      books
        .filter((b) => b.lastRead && new Date(b.lastRead).getTime() >= weekAgo)
        .map((b) => new Date(b.lastRead!).toDateString())
    );
    return { total: books.length, finished, pagesRead, weekDays: activeDays.size };
  }, [books]);

  /** 书签速览：全部书籍的书签按时间倒序取前 4 */
  const quickBookmarks = React.useMemo(() => {
    return books
      .flatMap((b) =>
        (b.bookmarks || []).map((bm) => ({ ...bm, bookTitle: b.title }))
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 4);
  }, [books]);

  const openReader = (bookId: string) => navigate(`/reader/${bookId}`);

  const handleDelete = (book: Book) => {
    if (window.confirm(`确定删除《${book.title}》吗？此操作不可恢复。`)) {
      deleteBook.mutate(book.id, {
        onSuccess: () => toast({ title: `已删除《${book.title}》` }),
      });
    }
  };

  return (
    <div className="h-full overflow-auto">
      <div className="p-8 grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_300px] gap-6 max-w-6xl mx-auto">
        {/* ============ 主内容列 ============ */}
        <div className="min-w-0">
          {/* 头部 */}
          <header className="flex items-center justify-between gap-4 mb-8">
            <h1 className="text-2xl font-bold shrink-0">书库</h1>
            <div className="flex items-center gap-3">
              <Button onClick={() => importBooks.mutate()} disabled={importBooks.isPending}>
                <Plus className="mr-1.5 h-4 w-4" />
                导入书籍
              </Button>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索书籍..."
                  className="h-10 w-44 rounded-md border border-input bg-background pl-8 pr-3 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
                />
              </div>
            </div>
          </header>

          {/* 继续阅读 */}
          {continueBook && !search && (
            <section className="mb-8">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-lg font-semibold">继续阅读</h2>
                <span className="text-xs text-muted-foreground">
                  上次阅读于 {formatTime(continueBook.lastRead)}
                </span>
              </div>
              <div className="rounded-xl border border-border bg-card p-5 flex gap-5 items-stretch">
                <button
                  className="w-24 h-36 rounded-lg overflow-hidden relative shrink-0 shadow-md"
                  style={{ background: coverGradient(continueBook.title) }}
                  onClick={() => openReader(continueBook.id)}
                >
                  <CoverArt bookId={continueBook.id} title={continueBook.title} charClass="text-4xl" />
                  <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-[10px] tracking-widest text-white/90 bg-black/30 px-2 py-0.5 rounded-full">
                    {continueBook.format}
                  </span>
                </button>
                <div className="flex-1 min-w-0 flex flex-col py-1">
                  <h3 className="text-lg font-semibold truncate">{continueBook.title}</h3>
                  <p className="text-sm text-muted-foreground mb-auto">
                    {continueBook.author === '未知作者' ? '' : `${continueBook.author} 著`}
                  </p>
                  <div className="mt-3">
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-primary transition-all"
                        style={{ width: `${Math.min(100, continueBook.readingProgress)}%` }}
                      />
                    </div>
                    <div className="flex justify-between mt-1.5 text-xs text-muted-foreground">
                      <span>{Math.round(continueBook.readingProgress)}% 已读</span>
                      <span>
                        剩余{' '}
                        {Math.max(
                          0,
                          (continueBook.totalPages || 0) - (continueBook.currentPage || 0)
                        )}{' '}
                        页
                      </span>
                    </div>
                  </div>
                  <div className="mt-4">
                    <Button onClick={() => openReader(continueBook.id)}>
                      <Play className="mr-1.5 h-4 w-4 fill-current" />
                      继续阅读
                    </Button>
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* 书籍列表 */}
          <section>
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="text-lg font-semibold">
                {search ? '搜索结果' : '全部书籍'}
              </h2>
              {!search && (
                <span className="text-xs text-muted-foreground">共 {books.length} 本</span>
              )}
            </div>

            {isLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-6">
                {[...Array(4)].map((_, i) => (
                  <div key={i}>
                    <div className="aspect-[2/3] rounded-lg bg-muted animate-pulse mb-2" />
                    <div className="h-3.5 w-3/4 rounded bg-muted animate-pulse mb-1.5" />
                    <div className="h-3 w-1/2 rounded bg-muted animate-pulse" />
                  </div>
                ))}
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
                <div className="w-24 h-24 mb-6 rounded-full bg-muted flex items-center justify-center">
                  <BookOpen className="w-10 h-10" strokeWidth={1.5} />
                </div>
                <h3 className="text-base font-medium text-foreground mb-2">
                  {search ? '没有找到匹配的书籍' : '书库是空的'}
                </h3>
                <p className="text-sm max-w-xs text-center">
                  {search
                    ? '换个关键词试试'
                    : '点击上方的「导入书籍」按钮，或使用菜单栏 文件 → 导入书籍，开始添加您的电子书。目前支持 TXT 正文阅读。'}
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-5 gap-y-6">
                {recentBooks.map((book) => (
                  <div key={book.id} className="group">
                    {/* 封面 */}
                    <div
                      className="relative aspect-[2/3] rounded-lg overflow-hidden cursor-pointer shadow-sm group-hover:shadow-lg transition-shadow"
                      style={{ background: coverGradient(book.title) }}
                      onClick={() => openReader(book.id)}
                    >
                      <CoverArt bookId={book.id} title={book.title} charClass="text-5xl" />
                      <span className="absolute top-2 left-2 text-[10px] font-medium text-white bg-black/35 px-2 py-0.5 rounded-full backdrop-blur-sm">
                        {FORMAT_LABELS[book.format.toLowerCase()] ?? book.format}
                      </span>
                      {book.readingProgress > 0 && (
                        <div className="absolute bottom-0 inset-x-0 h-1 bg-black/25">
                          <div
                            className="h-full bg-primary"
                            style={{ width: `${Math.min(100, book.readingProgress)}%` }}
                          />
                        </div>
                      )}
                      {/* 悬停操作 */}
                      <div className="absolute inset-0 bg-black/45 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                        <button
                          title="开始阅读"
                          className="w-9 h-9 rounded-full bg-primary text-primary-foreground flex items-center justify-center hover:scale-105 transition-transform"
                          onClick={(e) => {
                            e.stopPropagation();
                            openReader(book.id);
                          }}
                        >
                          <Play className="h-4 w-4 fill-current" />
                        </button>
                        <button
                          title="删除"
                          className="w-9 h-9 rounded-full bg-white/20 text-white flex items-center justify-center hover:bg-destructive transition-colors"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(book);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <h4
                      className="mt-2 text-sm font-medium truncate cursor-pointer hover:text-primary"
                      onClick={() => openReader(book.id)}
                    >
                      {book.title}
                    </h4>
                    <p className="text-xs text-muted-foreground truncate">
                      {book.author === '未知作者' ? '' : book.author}
                      {book.lastRead && ` · ${formatTime(book.lastRead)}`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ============ 右侧统计面板 ============ */}
        <aside className={cn('space-y-5', books.length === 0 && 'hidden xl:block')}>
          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold mb-4">阅读统计</h3>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between items-baseline">
                <dt className="text-muted-foreground">收藏书籍</dt>
                <dd>
                  <span className="text-xl font-bold">{stats.total}</span>
                  <span className="text-xs text-muted-foreground ml-1">本</span>
                </dd>
              </div>
              <div className="flex justify-between items-baseline">
                <dt className="text-muted-foreground">已读完</dt>
                <dd>
                  <span className="text-xl font-bold">{stats.finished}</span>
                  <span className="text-xs text-muted-foreground ml-1">本</span>
                </dd>
              </div>
              <div className="flex justify-between items-baseline">
                <dt className="text-muted-foreground">累计阅读</dt>
                <dd>
                  <span className="text-xl font-bold">{stats.pagesRead}</span>
                  <span className="text-xs text-muted-foreground ml-1">页</span>
                </dd>
              </div>
            </dl>
            <div className="mt-5 pt-4 border-t border-border">
              <div className="flex justify-between text-xs mb-2">
                <span className="text-muted-foreground">本周活跃</span>
                <span className="font-medium">{stats.weekDays}/7 天</span>
              </div>
              <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${(stats.weekDays / 7) * 100}%` }}
                />
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-border bg-card p-5">
            <h3 className="text-sm font-semibold mb-4">书签速览</h3>
            {quickBookmarks.length === 0 ? (
              <p className="text-xs text-muted-foreground leading-relaxed">
                阅读时点击工具栏的书签按钮，即可在这里快速跳转。
              </p>
            ) : (
              <ul className="space-y-3">
                {quickBookmarks.map((bm) => (
                  <li
                    key={bm.id}
                    className="flex gap-2.5 cursor-pointer group"
                    onClick={() => bm.bookId && openReader(bm.bookId)}
                  >
                    <span className="mt-1 w-2 h-2 rounded-full shrink-0 bg-primary" />
                    <div className="min-w-0">
                      <p className="text-xs font-medium truncate group-hover:text-primary">
                        {bm.bookTitle}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        第 {bm.position}%{bm.chapter ? ` · ${bm.chapter}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
