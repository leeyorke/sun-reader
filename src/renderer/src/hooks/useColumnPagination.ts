/**
 * useColumnPagination - 基于 CSS 多列的真实分页
 *
 * 原理：内容容器固定为视口高度，设置 column-width 让文本横向流式分成若干列，
 * 外层 overflow:hidden，通过 translateX 每次平移一「屏」实现翻页。
 * 视口缩放或字号变化时文本自动重排（不出滚动条，装不下的字进入下一页），
 * 并按比例保持当前阅读位置。
 */

import * as React from 'react';

/** 翻页器对外能力（供父组件键盘路由与弹窗跳转） */
export interface PagerHandle {
  next: () => void;
  prev: () => void;
  /** 跳到选择器命中元素所在页（DOM 实测 offsetLeft；TXT=[data-pidx]、EPUB=[data-chidx]） */
  goToElement: (selector: string) => void;
  /** 跳到 rootSelector 命明容器内第 offset 个字符所在页（EPUB 划线/搜索定位） */
  goToTextOffset: (rootSelector: string, offset: number) => void;
  /** 按百分比跳页（书签/旧批注定位） */
  goToPercent: (pct: number) => void;
  /** 当前阅读位置锚点（data-anchor 索引），改字号重排/保存进度用 */
  getAnchor: () => { index: number; offset: number } | null;
}

/** 正文锚点（与 ReaderPage 的 data-anchor 编号一致） */
export interface ReadingAnchor {
  index: number;
  offset: number;
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
  /** 首次量取时的正文锚点（优先于百分比，精确恢复阅读位置） */
  initialAnchor?: ReadingAnchor | null;
  /** 当前屏变化回调（page 从 0 开始） */
  onPageChange?: (page: number, total: number) => void;
}

interface Metrics {
  step: number;
  colW: number;
}

export function useColumnPagination({ columns, deps, initialPercent = 0, initialAnchor = null, onPageChange }: Options) {
  const depList = Array.isArray(deps) ? deps : [];
  const viewportRef = React.useRef<HTMLDivElement | null>(null);
  const contentRef = React.useRef<HTMLDivElement | null>(null);

  const [indicator, setIndicator] = React.useState({ page: 0, total: 1 });
  const metricsRef = React.useRef<Metrics>({ step: 0, colW: 0 });
  const pageRef = React.useRef(0);
  const totalRef = React.useRef(1);
  const initialConsumedRef = React.useRef(initialPercent <= 0 && !initialAnchor);
  /** 当前窗口起点对应的正文锚点（改字号重排/保存进度时按它恢复，而非按比例） */
  const anchorRef = React.useRef<ReadingAnchor | null>(null);
  const pendingAnchorRef = React.useRef<ReadingAnchor | null>(initialAnchor ?? null);
  const reportedRef = React.useRef<{ page: number; total: number } | null>(null);
  const onPageRef = React.useRef(onPageChange);
  onPageRef.current = onPageChange;

  const applyTransform = React.useCallback(() => {
    const ct = contentRef.current;
    if (!ct) return;
    ct.style.transform = `translateX(${-pageRef.current * metricsRef.current.step}px)`;
  }, []);

  /** 锚点元素索引（data-anchor），返回其在多列中的起始列 */
  const anchorColIndex = React.useCallback((i: number): number => {
    const ct = contentRef.current;
    if (!ct) return -1;
    const el = ct.querySelector<HTMLElement>(`[data-anchor="${i}"]`);
    if (!el) return -1;
    const { colW } = metricsRef.current;
    if (colW <= 0) return -1;
    return Math.max(0, Math.round(el.offsetLeft / (colW + GAP)));
  }, []);

  /** 捕获当前窗口起点的锚点（窗口左缘经过的最后一个锚元素） */
  const captureAnchor = React.useCallback((): ReadingAnchor | null => {
    const ct = contentRef.current;
    if (!ct) return null;
    const x = pageRef.current * metricsRef.current.step;
    let best: { i: number; x: number } | null = null;
    for (const el of ct.querySelectorAll<HTMLElement>('[data-anchor]')) {
      const i = Number(el.dataset.anchor);
      if (!Number.isInteger(i) || i < 0) continue;
      if (el.offsetLeft <= x + 4) {
        if (!best || el.offsetLeft >= best.x) best = { i, x: el.offsetLeft };
      } else break; // 内容按文档顺序排列，offsetLeft 单调
    }
    if (!best) {
      const first = ct.querySelector<HTMLElement>('[data-anchor]');
      return first ? { index: Number(first.dataset.anchor) || 0, offset: 0 } : null;
    }
    return { index: best.i, offset: 0 };
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
    // 实测列高发布为 CSS 变量：正文图片按它收缩，保证整图能放进一列
    // （多列布局里比列还高的图无处可去，会被 overflow:hidden 裁掉半截）
    ct.style.setProperty('--col-h', `${vh}px`);

    // 强制同步回流后读取总宽度
    void ct.offsetHeight;
    const cols = Math.max(1, Math.round((ct.scrollWidth + GAP) / (colW + GAP)));
    const pages = Math.max(1, Math.ceil(cols / columns));

    // 定位策略：待生效锚点（进入时的初始锚）→ 已捕获锚点（改字号/缩放重排）→ 元素实测；
    // 均失效时按比例保持，首测无锚按初始百分比
    let nextPage = -1;
    const pending = pendingAnchorRef.current;
    const restoreFrom = pending ?? anchorRef.current;
    if (restoreFrom) {
      const colIndex = anchorColIndex(restoreFrom.index);
      if (colIndex >= 0) nextPage = Math.min(pages - 1, Math.floor(colIndex / columns));
    }
    if (pending) {
      pendingAnchorRef.current = null;
      initialConsumedRef.current = true;
    }
    if (nextPage < 0) {
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
    }

    const changed =
      totalRef.current !== pages ||
      pageRef.current !== nextPage ||
      reportedRef.current?.page !== nextPage;

    totalRef.current = pages;
    pageRef.current = nextPage;
    applyTransform();
    // 锚点随新位置更新（下一次重排按内容位置恢复，而不是按比例跳变）
    anchorRef.current = captureAnchor();

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
      anchorRef.current = captureAnchor(); // 手动翻页后锚点同步，改字号时仍按内容位置恢复
      setIndicator({ page: clamped, total: totalRef.current });
      reportedRef.current = { page: clamped, total: totalRef.current };
      onPageRef.current?.(clamped, totalRef.current);
    },
    [applyTransform, captureAnchor]
  );

  const next = React.useCallback(() => goToPage(pageRef.current + 1), [goToPage]);
  const prev = React.useCallback(() => goToPage(pageRef.current - 1), [goToPage]);

  /** 元素 → 所在列 → 所在页：实测元素在多列容器中的横向位置 */
  const goToElement = React.useCallback(
    (selector: string) => {
      const ct = contentRef.current;
      if (!ct) return;
      const el = ct.querySelector<HTMLElement>(selector);
      if (!el) return;
      const { colW } = metricsRef.current;
      if (colW <= 0) return;
      const colIndex = Math.max(0, Math.round(el.offsetLeft / (colW + GAP)));
      goToPage(Math.floor(colIndex / columns));
    },
    [columns, goToPage]
  );

  /**
   * 文本偏移 → 所在页：在 rootSelector 容器内按 TreeWalker 累计文本长度定位到
   * 第 offset 个字符，用 Range 包围盒反推所在列（补回当前 translateX 位移）。
   * EPUB 划线/搜索命中定位用。
   */
  const goToTextOffset = React.useCallback(
    (rootSelector: string, offset: number) => {
      const ct = contentRef.current;
      if (!ct) return;
      const root = ct.querySelector(rootSelector);
      if (!root || offset < 0) return;

      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let acc = 0;
      let target: Text | null = null;
      let targetOff = 0;
      while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        const len = node.data?.length ?? 0;
        if (acc + len >= offset) {
          target = node;
          targetOff = offset - acc;
          break;
        }
        acc += len;
      }
      if (!target) return;

      const range = document.createRange();
      const startOff = Math.min(targetOff, target.length);
      range.setStart(target, startOff);
      // 折叠 Range 的包围盒可能为 0，多包一个字符保证有几何信息
      range.setEnd(target, Math.min(startOff + 1, target.length));
      let rect = range.getBoundingClientRect();
      if (!rect || (!rect.width && !rect.height)) {
        range.collapse(true);
        rect = range.getBoundingClientRect();
      }

      const { colW, step } = metricsRef.current;
      if (colW <= 0 || step <= 0) return;
      const ctRect = ct.getBoundingClientRect();
      // rect 与 ctRect 都是应用位移后的屏幕坐标，二者相减已抵消 translateX，
      // 结果即内容流坐标（此处不能再加回当前位移，否则跳转目标随当前页漂移）
      const xRaw = (rect.left || ctRect.left) - ctRect.left;
      const colIndex = Math.max(0, Math.round(xRaw / (colW + GAP)));
      goToPage(Math.floor(colIndex / columns));
    },
    [columns, goToPage]
  );

  const goToPercent = React.useCallback(
    (pct: number) => {
      const clampedPct = Math.max(0, Math.min(100, pct));
      goToPage(Math.round((clampedPct / 100) * (totalRef.current - 1)));
    },
    [goToPage]
  );

  return {
    viewportRef,
    contentRef,
    page: indicator.page,
    total: indicator.total,
    next,
    prev,
    goToPage,
    goToElement,
    goToTextOffset,
    goToPercent,
    getAnchor: () => anchorRef.current,
  };
}
