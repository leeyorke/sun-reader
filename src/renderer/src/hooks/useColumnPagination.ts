/**
 * useColumnPagination - 基于 CSS 多列的真实分页
 *
 * 原理：内容容器固定为视口高度，设置 column-width 让文本横向流式分成若干列，
 * 外层 overflow:hidden，通过 translateX 每次平移一「屏」实现翻页。
 * 视口缩放或字号变化时文本自动重排（不出滚动条，装不下的字进入下一页），
 * 并按比例保持当前阅读位置。
 */

import * as React from 'react';

/** 翻页器对外能力（供父组件键盘路由） */
export interface PagerHandle {
  next: () => void;
  prev: () => void;
}

/** 相邻两列的间距 */
const GAP = 72;

interface Options {
  /** 每屏列数：沉浸模式 = 1，双页模式 = 2 */
  columns: 1 | 2;
  /** 影响排版的内容依赖（段落数组、字号行高等），变化时重新量取 */
  deps: React.DependencyList;
  /** 首次量取时的初始阅读进度百分比 */
  initialPercent?: number;
  /** 当前屏变化回调（page 从 0 开始） */
  onPageChange?: (page: number, total: number) => void;
}

interface Metrics {
  step: number;
  colW: number;
}

export function useColumnPagination({ columns, deps, initialPercent = 0, onPageChange }: Options) {
  const depList = Array.isArray(deps) ? deps : [];
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  const [indicator, setIndicator] = React.useState({ page: 0, total: 1 });
  const metricsRef = React.useRef<Metrics>({ step: 0, colW: 0 });
  const pageRef = React.useRef(0);
  const totalRef = React.useRef(1);
  const initialConsumedRef = React.useRef(initialPercent <= 0);
  const reportedRef = React.useRef<{ page: number; total: number } | null>(null);
  const onPageRef = React.useRef(onPageChange);
  onPageRef.current = onPageChange;

  const applyTransform = React.useCallback(() => {
    const ct = contentRef.current;
    if (!ct) return;
    ct.style.transform = `translateX(${-pageRef.current * metricsRef.current.step}px)`;
  }, []);

  /** 量取列宽/总列数并应用位移。布局变化（窗口缩放、字号、内容）都会走到这里 */
  const measure = React.useCallback(() => {
    const vp = viewportRef.current;
    const ct = contentRef.current;
    if (!vp || !ct) return;

    const vw = vp.clientWidth;
    const vh = vp.clientHeight;
    if (vw < 60 || vh < 60) return; // 尚未完成布局

    const colW = columns === 2 ? Math.floor((vw - GAP) / 2) : vw;
    const step = columns === 2 ? 2 * (colW + GAP) : colW + GAP;
    metricsRef.current = { step, colW };

    ct.style.columnWidth = `${colW}px`;
    ct.style.columnGap = `${GAP}px`;

    // 强制同步回流后读取总宽度
    void ct.offsetHeight;
    const cols = Math.max(1, Math.round((ct.scrollWidth + GAP) / (colW + GAP)));
    const pages = Math.max(1, Math.ceil(cols / columns));

    // 定位策略：首测用初始进度；之后重排按比例保持位置
    let nextPage: number;
    if (!initialConsumedRef.current && initialPercent > 0 && pages > 1) {
      nextPage = Math.min(pages - 1, Math.max(0, Math.round((initialPercent / 100) * (pages - 1))));
      initialConsumedRef.current = true;
    } else {
      const prevTotal = totalRef.current;
      const prevPage = pageRef.current;
      nextPage =
        prevTotal > 1
          ? Math.min(pages - 1, Math.max(0, Math.round(((prevPage + 1) / prevTotal) * pages) - 1))
          : Math.min(prevPage, pages - 1);
    }

    const changed =
      totalRef.current !== pages ||
      pageRef.current !== nextPage ||
      reportedRef.current?.page !== nextPage;

    totalRef.current = pages;
    pageRef.current = nextPage;
    applyTransform();

    if (changed) {
      setIndicator({ page: nextPage, total: pages });
      reportedRef.current = { page: nextPage, total: pages };
      onPageRef.current?.(nextPage, pages);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [columns, initialPercent]);

  // 内容或排版参数变化后重新量取
  React.useLayoutEffect(() => {
    measure();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...depList, measure]);

  // 视口随窗口缩放时重量取（无滚动条、文字流入下一屏）
  React.useLayoutEffect(() => {
    const vp = viewportRef.current;
    if (!vp || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => measure());
    ro.observe(vp);
    return () => ro.disconnect();
  }, [measure]);

  // 字体异步加载完成后可能改变度量，补一次量取
  React.useEffect(() => {
    let alive = true;
    document.fonts?.ready.then(() => {
      if (alive) measure();
    });
    return () => {
      alive = false;
    };
  }, [measure]);

  const goToPage = React.useCallback(
    (page: number) => {
      const clamped = Math.max(0, Math.min(totalRef.current - 1, page));
      if (clamped === pageRef.current) return;
      pageRef.current = clamped;
      applyTransform();
      setIndicator({ page: clamped, total: totalRef.current });
      reportedRef.current = { page: clamped, total: totalRef.current };
      onPageRef.current?.(clamped, totalRef.current);
    },
    [applyTransform]
  );

  const next = React.useCallback(() => goToPage(pageRef.current + 1), [goToPage]);
  const prev = React.useCallback(() => goToPage(pageRef.current - 1), [goToPage]);

  return { viewportRef, contentRef, page: indicator.page, total: indicator.total, next, prev, goToPage };
}
