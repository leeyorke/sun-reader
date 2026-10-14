/**
 * DualPageView - 双页阅读视图（唯一阅读模式）
 *
 * 全屏书页式左右两栏（CSS 多列分页），无顶栏/底栏/进度条：
 * - 阅读区四周留白，书面底色（--reader-page）与 app 背景区分；
 * - 底部悬浮 dock 工具栏（闲置自动隐藏）承载：退出阅读页面、翻页、字号±、
 *   主题循环、搜索、书签，以及 目录 / 书签列表 / 我的批注 三个弹窗入口；
 * - 左右边缘点击热区翻页，窗口缩放时自动重排并保持阅读位置。
 */

import * as React from 'react';
import {
  BookMarked,
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  ListTree,
  Minus,
  Moon,
  Plus as PlusIcon,
  Search,
  Shrink,
  StickyNote,
} from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { hasCustomCaption } from '@/api/electronApi';
import { THEMES, THEME_LABELS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useColumnPagination, type PagerHandle } from '@/hooks/useColumnPagination';

export interface DualPageViewProps {
  /** 正文内容节点（TXT 文本块 / EPUB 原书渲染均由 ReaderPage 组装） */
  content: React.ReactNode;
  /** content 容器 id（EPUB 作用域化 CSS 以 #book-flow 为前缀） */
  contentId?: string;
  articleStyle: React.CSSProperties;
  /** 影响排版的依赖（内容块引用、字号、行高），变化时重新分页 */
  layoutDeps: React.DependencyList;
  /** 进入时的阅读进度百分比 */
  initialPercent?: number;
  /** 进入时的正文锚点（优先于百分比，精确恢复位置） */
  initialAnchor?: { index: number; offset: number } | null;
  onPageChange?: (page: number, total: number) => void;
  // ---- dock 栏交互（均由 ReaderPage 提供）----
  /** 退出阅读页面（返回书库） */
  onExit: () => void;
  onIncreaseFont: () => void;
  onDecreaseFont: () => void;
  onToggleBookmark: () => void;
  isBookmarked: boolean;
  onOpenSearch: () => void;
  onOpenToc: () => void;
  onOpenBookmarks: () => void;
  onOpenNotes: () => void;
  /** 正文选区松开（划线/批注入口，由 ReaderPage 判定选区有效性） */
  onArticleMouseUp?: (e: React.MouseEvent) => void;
  /** 正文单击（点击划线/批注高亮处弹出批注，由 ReaderPage 反查命中） */
  onContentClick?: (e: React.MouseEvent) => void;
}

export const DualPageView = React.forwardRef<PagerHandle, DualPageViewProps>(
  function DualPageView(
    {
      content,
      contentId,
      articleStyle,
      layoutDeps,
      initialPercent,
      initialAnchor,
      onPageChange,
      onExit,
      onIncreaseFont,
      onDecreaseFont,
      onToggleBookmark,
      isBookmarked,
      onOpenSearch,
      onOpenToc,
      onOpenBookmarks,
      onOpenNotes,
      onArticleMouseUp,
      onContentClick,
    },
    ref
  ) {
    const { theme, setTheme } = useTheme();
    const [dockVisible, setDockVisible] = React.useState(true);
    const hideTimer = React.useRef<number | null>(null);

    const { viewportRef, contentRef, page, total, pages, next, prev, goToElement, goToTextOffset, goToPercent, getAnchor, getPageInfo } =
      useColumnPagination({
        columns: 2,
        deps: layoutDeps,
        initialPercent,
        initialAnchor,
        onPageChange,
      });

    // 暴露给父组件：键盘路由（next/prev）+ 弹窗跳转（goToElement/goToTextOffset/goToPercent）
    React.useImperativeHandle(
      ref,
      () => ({ next, prev, goToElement, goToTextOffset, goToPercent, getAnchor, getPageInfo }),
      [next, prev, goToElement, goToTextOffset, goToPercent, getAnchor, getPageInfo]
    );

    const poke = React.useCallback(() => {
      setDockVisible(true);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setDockVisible(false), 2600);
    }, []);

    React.useEffect(() => {
      poke();
      return () => {
        if (hideTimer.current) window.clearTimeout(hideTimer.current);
      };
    }, [poke]);

    // 进度文字（页面中下方）：一列 = 一页，pages 是实测总列数（书库写回的
    // totalPages 用的同一个数，两处口径必须一致），末屏可能只有一页
    const firstPage = Math.min(page * 2 + 1, pages);
    const lastPage = Math.min(page * 2 + 2, pages);
    const pageLabel = firstPage === lastPage ? `${firstPage}` : `${firstPage} - ${lastPage}`;
    const pct = total > 0 ? ((page + 1) / total) * 100 : 0;

    // 顶部 32px 是窗口拖拽区（见 Layout），翻页热区要让开
    const customCaption = hasCustomCaption();

    return (
      <div
        className="fixed inset-0 z-[1000] bg-background flex flex-col"
        onMouseMove={poke}
        onClick={poke}
        onMouseUp={onArticleMouseUp}
      >
        {/* 书页：四周留出呼吸边距（热区空间），底色与 app 背景区分 */}
        <main className="flex-1 min-h-0 overflow-hidden p-6 md:p-10">
          <div className="reader-page-surface w-full h-full rounded-xl border border-border shadow-xl p-6 md:p-10">
            <div ref={viewportRef} className="relative w-full h-full overflow-hidden">
              {/* 中缝装饰线 */}
              <div
                aria-hidden
                className="absolute inset-y-2 left-1/2 w-px bg-border/70 pointer-events-none"
              />

              <div
                ref={contentRef}
                id={contentId}
                className="classic-text h-full"
                style={{ ...articleStyle, columnFill: 'auto', willChange: 'transform' }}
                onClick={onContentClick}
              >
                {content}
              </div>
            </div>
          </div>
        </main>

        {/* 左右点击热区（自定义标题栏时避开顶部 32px 拖拽区，否则点角落会拖动窗口） */}
        <button
          aria-label="上一页"
          title="上一页"
          className={cn(
            'absolute left-0 bottom-0 w-16 group flex items-center justify-start',
            customCaption && 'top-8'
          )}
          onClick={(e) => {
            e.stopPropagation();
            prev();
          }}
        >
          <ChevronLeft className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
        <button
          aria-label="下一页"
          title="下一页"
          className={cn(
            'absolute right-0 bottom-0 w-16 group flex items-center justify-end',
            customCaption && 'top-8'
          )}
          onClick={(e) => {
            e.stopPropagation();
            next();
          }}
        >
          <ChevronRight className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>

        {/* 进度文字：常驻阅读页面中下方（页码区间 + 总页数 + 百分比，无进度条） */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none select-none">
          <span className="text-xs text-muted-foreground tabular-nums opacity-80">
            第 {pageLabel} 页 · 共 {pages} 页 · {Math.round(pct)}%
          </span>
        </div>

        {/* 底部悬浮 dock 工具栏（闲置自动隐藏） */}
        <div
          data-no-annotation
          className={cn(
            'absolute bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-0.5 rounded-full border border-border bg-popover text-popover-foreground shadow-xl px-2 py-1.5 transition-all duration-300',
            dockVisible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-4 pointer-events-none'
          )}
        >
          <ToolButton title="退出阅读页面" onClick={onExit}>
            <Shrink className="h-4 w-4" />
          </ToolButton>
          <span className="w-px h-5 bg-border mx-1" />
          <ToolButton title="上一页" onClick={prev} disabled={page === 0}>
            <ChevronLeft className="h-4 w-4" />
          </ToolButton>
          <ToolButton title="下一页" onClick={next} disabled={page >= total - 1}>
            <ChevronRight className="h-4 w-4" />
          </ToolButton>
          <span className="w-px h-5 bg-border mx-1" />
          <ToolButton title="减小字号" onClick={onDecreaseFont}>
            <Minus className="h-4 w-4" />
          </ToolButton>
          <ToolButton title="增大字号" onClick={onIncreaseFont}>
            <PlusIcon className="h-4 w-4" />
          </ToolButton>
          <ToolButton
            title={`主题：${THEME_LABELS[theme]}（点击切换）`}
            onClick={() => setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length])}
          >
            <Moon className="h-4 w-4" />
          </ToolButton>
          <ToolButton title="搜索正文" onClick={onOpenSearch}>
            <Search className="h-4 w-4" />
          </ToolButton>
          <ToolButton
            title={isBookmarked ? '移除此处书签' : '在此处添加书签'}
            onClick={onToggleBookmark}
            active={isBookmarked}
          >
            {isBookmarked ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
          </ToolButton>
          <span className="w-px h-5 bg-border mx-1" />
          <ToolButton title="目录" onClick={onOpenToc}>
            <ListTree className="h-4 w-4" />
          </ToolButton>
          <ToolButton title="书签列表" onClick={onOpenBookmarks}>
            <BookMarked className="h-4 w-4" />
          </ToolButton>
          <ToolButton title="我的批注" onClick={onOpenNotes}>
            <StickyNote className="h-4 w-4" />
          </ToolButton>
        </div>
      </div>
    );
  }
);

function ToolButton({
  children,
  title,
  onClick,
  active,
  disabled,
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
}) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseDown={(e) => e.stopPropagation()}
      className={cn(
        'w-9 h-9 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 disabled:pointer-events-none',
        active
          ? 'text-primary'
          : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
      )}
    >
      {children}
    </button>
  );
}
