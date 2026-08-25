/**
 * DualPageView - 双页阅读模式
 * 设计稿 .backup/dual-page.html：书页式左右两栏、页码、上一页/下一页导航
 * 阅读方式：双栏跨页左右翻（CSS 多列分页），铺满可用空间；窗口缩放时自动重排，不出滚动条。
 */

import * as React from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { useColumnPagination, type PagerHandle } from '@/hooks/useColumnPagination';

export interface DualPageViewProps {
  paragraphs: string[];
  /** 正文渲染器（复用字号/行高等设置） */
  renderParagraphs: (paras: string[], startIdx: number) => React.ReactNode;
  articleStyle: React.CSSProperties;
  /** 影响排版的依赖（段落引用、字号、行高），变化时重新分页 */
  layoutDeps: React.DependencyList;
  /** 进入时的阅读进度百分比 */
  initialPercent?: number;
  onPageChange?: (page: number, total: number) => void;
  onExit: () => void;
}

export const DualPageView = React.forwardRef<PagerHandle, DualPageViewProps>(
  function DualPageView(
    { paragraphs, renderParagraphs, articleStyle, layoutDeps, initialPercent, onPageChange, onExit },
    ref
  ) {
    const { viewportRef, contentRef, page, total, next, prev } = useColumnPagination({
      columns: 2,
      deps: layoutDeps,
      initialPercent,
      onPageChange,
    });

    // 暴露给父组件的键盘路由
    React.useImperativeHandle(ref, () => ({ next, prev }), [next, prev]);

    const totalPages = total * 2; // 每个跨页约两页（最后一页可能为半页）
    const pageLabel = `${Math.min(page * 2 + 1, totalPages)} - ${Math.min(page * 2 + 2, totalPages)}`;

    return (
      <div className="fixed inset-0 z-[1000] bg-background flex flex-col">
        {/* 顶栏：返回按钮（退出双页模式） */}
        <header className="flex items-center px-3 h-10 shrink-0">
          <button
            onClick={onExit}
            title="退出双页模式 (Esc)"
            className="w-9 h-9 rounded-full flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
        </header>

        {/* 书页：铺满剩余空间 */}
        <main className="flex-1 min-h-0 overflow-hidden p-3 md:p-5">
          <div className="w-full h-full rounded-xl border border-border bg-card shadow-xl p-6 md:p-10">
            <div ref={viewportRef} className="relative w-full h-full overflow-hidden">
              {/* 中缝装饰线 */}
              <div
                aria-hidden
                className="absolute inset-y-2 left-1/2 w-px bg-border/70 pointer-events-none"
              />

              <div
                ref={contentRef}
                className="classic-text h-full"
                style={{ ...articleStyle, columnFill: 'auto', willChange: 'transform' }}
              >
                {renderParagraphs(paragraphs, 0)}
              </div>
            </div>
          </div>
        </main>

        {/* 左右点击热区 */}
        <button
          aria-label="上一页"
          title="上一页"
          className="absolute left-0 top-12 bottom-14 w-14 group flex items-center justify-start"
          onClick={prev}
        >
          <ChevronLeft className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>
        <button
          aria-label="下一页"
          title="下一页"
          className="absolute right-0 top-12 bottom-14 w-14 group flex items-center justify-end"
          onClick={next}
        >
          <ChevronRight className="h-7 w-7 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
        </button>

        {/* 底部导航 */}
        <footer className="h-12 shrink-0 border-t border-border flex items-center justify-center gap-4">
          <button
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-40 transition-colors"
            onClick={prev}
            disabled={page === 0}
          >
            <ChevronLeft className="h-4 w-4" />
            上一页
          </button>
          <span className="text-xs text-muted-foreground tabular-nums">
            第{' '}
            <span className="text-foreground font-medium">{pageLabel}</span>{' '}
            页 · 共约 {totalPages} 页
          </span>
          <button
            className="flex items-center gap-1 px-3 py-1.5 rounded-md text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground disabled:opacity-40 transition-colors"
            onClick={next}
            disabled={page >= total - 1}
          >
            下一页
            <ChevronRight className="h-4 w-4" />
          </button>
        </footer>
      </div>
    );
  }
);
