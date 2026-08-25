/**
 * ImmersiveView - 沉浸阅读模式
 * 设计稿 .backup/immersive.html：全屏正文 + 左右边缘翻页区 + 悬浮工具栏（闲置自动隐藏）
 * 阅读方式：单栏左右翻页（CSS 多列分页），无滚动条；窗口缩放时自动重排。
 */

import * as React from 'react';
import {
  Bookmark,
  BookmarkCheck,
  ChevronLeft,
  ChevronRight,
  Minus,
  Moon,
  Plus as PlusIcon,
  Search,
  Shrink,
} from 'lucide-react';
import { useTheme } from '@/components/theme-provider';
import { THEMES, THEME_LABELS } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { useColumnPagination, type PagerHandle } from '@/hooks/useColumnPagination';

export interface ImmersiveViewProps {
  paragraphs: string[];
  /** 正文渲染器（复用字号/行高等设置） */
  renderParagraphs: (paras: string[], startIdx: number) => React.ReactNode;
  articleStyle: React.CSSProperties;
  /** 影响排版的依赖（段落引用、字号、行高），变化时重新分页 */
  layoutDeps: React.DependencyList;
  /** 进入时的阅读进度百分比 */
  initialPercent?: number;
  onPageChange?: (page: number, total: number) => void;
  isBookmarked: boolean;
  onExit: () => void;
  onIncreaseFont: () => void;
  onDecreaseFont: () => void;
  onToggleBookmark: () => void;
  onOpenSearch: () => void;
}

export const ImmersiveView = React.forwardRef<PagerHandle, ImmersiveViewProps>(
  function ImmersiveView(
    {
      paragraphs,
      renderParagraphs,
      articleStyle,
      layoutDeps,
      initialPercent,
      onPageChange,
      isBookmarked,
      onExit,
      onIncreaseFont,
      onDecreaseFont,
      onToggleBookmark,
      onOpenSearch,
    },
    ref
  ) {
    const { theme, setTheme } = useTheme();
    const [toolbarVisible, setToolbarVisible] = React.useState(true);
    const hideTimer = React.useRef<number | null>(null);

    const { viewportRef, contentRef, page, total, next, prev } = useColumnPagination({
      columns: 1,
      deps: layoutDeps,
      initialPercent,
      onPageChange,
    });

    // 暴露给父组件的键盘路由
    React.useImperativeHandle(ref, () => ({ next, prev }), [next, prev]);

    const poke = React.useCallback(() => {
      setToolbarVisible(true);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setToolbarVisible(false), 2600);
    }, []);

    React.useEffect(() => {
      poke();
      return () => {
        if (hideTimer.current) window.clearTimeout(hideTimer.current);
      };
    }, [poke]);

    return (
      <div
        className="fixed inset-0 z-[1000] bg-background flex flex-col"
        onMouseMove={poke}
        onClick={poke}
      >
        {/* 正文：单栏分页，外层留白兼作裁切边距 */}
        <div className="flex-1 min-h-0 px-10 md:px-16 py-8">
          <div ref={viewportRef} className="w-full h-full overflow-hidden">
            <div
              ref={contentRef}
              className="classic-text h-full"
              style={{ ...articleStyle, columnFill: 'auto', willChange: 'transform' }}
            >
              {renderParagraphs(paragraphs, 0)}
            </div>
          </div>
        </div>

        {/* 页码角标 */}
        <div className="absolute top-4 right-6 text-xs text-muted-foreground tabular-nums pointer-events-none select-none">
          {page + 1} / {total}
        </div>

        {/* 左右翻页热区 */}
        <button
          aria-label="上一页"
          className="absolute left-0 top-0 bottom-0 w-20 group flex items-center justify-start pl-2"
          onClick={(e) => {
            e.stopPropagation();
            prev();
          }}
        >
          <ChevronLeft className="h-8 w-8 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
        <button
          aria-label="下一页"
          className="absolute right-0 top-0 bottom-0 w-20 group flex items-center justify-end pr-2"
          onClick={(e) => {
            e.stopPropagation();
            next();
          }}
        >
          <ChevronRight className="h-8 w-8 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>

        {/* 悬浮工具栏 */}
        <div
          className={cn(
            'absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full border border-border bg-popover text-popover-foreground shadow-xl px-2 py-1.5 transition-all duration-300',
            toolbarVisible
              ? 'opacity-100 translate-y-0'
              : 'opacity-0 translate-y-4 pointer-events-none'
          )}
        >
          <ToolButton title="退出沉浸模式 (Esc)" onClick={onExit}>
            <Shrink className="h-4 w-4" />
          </ToolButton>
          <span className="w-px h-5 bg-border mx-1" />
          <ToolButton title="上一页" onClick={prev}>
            <ChevronLeft className="h-4 w-4" />
          </ToolButton>
          <ToolButton title="下一页" onClick={next}>
            <ChevronRight className="h-4 w-4" />
          </ToolButton>
          <span className="w-px h-5 bg-border mx-1" />
          <ToolButton title="减小字号（或右键 A+ 减小）" onClick={onDecreaseFont}>
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
          <ToolButton title="搜索" onClick={onOpenSearch}>
            <Search className="h-4 w-4" />
          </ToolButton>
          <ToolButton title={isBookmarked ? '已加书签' : '添加书签'} onClick={onToggleBookmark} active={isBookmarked}>
            {isBookmarked ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
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
}: {
  children: React.ReactNode;
  title: string;
  onClick: () => void;
  active?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onMouseDown={(e) => e.stopPropagation()}
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
