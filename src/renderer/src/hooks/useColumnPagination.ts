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
  /** 实测分页信息（落盘进度用，与阅读页底部显示的页码同源） */
  getPageInfo: () => PageInfo;
}

/**
 * 实测分页信息。**「页」= 一列**（双页视图一屏两页），与阅读页底部
 * 「第 x - y 页 · 共 n 页」以及书库写回的 currentPage/totalPages 同一套口径。
 */
export interface PageInfo {
  /** 当前屏序号（0 起） */
  spread: number;
  /** 总屏数 */
  spreads: number;
  /** 总页数（= 总列数）。**0 表示尚未量取**，调用方此时不应据此写库 */
  pages: number;
  /** 当前屏左页页码（1 起） */
  firstPage: number;
}

/**
 * 正文锚点（与 ReaderPage 的 data-anchor 编号一致）。
 *
 * `offset` = 窗口起点落在该锚元素内的位置，取**占该元素列跨度的比例** [0,1)。
 * 只记 index（offset 恒 0）时，任何一次重新量取都把画面拽回**锚元素起点**：EPUB 的
 * 一个 spine 章可横跨几十列，于是「目录跳到第二章 → 一次 re-measure → 退回上一章的
 * 参考文献页」（实测 col 66 → col 62），「退出重开」也只能落回章首而不是退出那一页。
 * 用比例：同一排版下 round 后原样还原（幂等，不再漂移），改字号后按新的列跨度折算，
 * 误差被限制在锚元素之内。旧数据（offset 恒 0 / 非 [0,1) 值）按 0 处理。
 */
export interface ReadingAnchor {
  index: number;
  offset: number;
}

/** 相邻两列的间距 */
const GAP = 72;

/**
 * 内容流横坐标 → 列号。
 * 用 floor 而不是 round：round 会把「列后半段」算进下一列（列宽 675 + 间距 72 时，
 * 列内 x=1300 会被算成第 2 列），双页模式下就是整屏跳错一页；+1 只为吸收列首的亚像素误差。
 */
export function columnIndexAt(x: number, colW: number): number {
  return Math.max(0, Math.floor((x + 1) / (colW + GAP)));
}

/**
 * 窗口起始列 → 锚点的 `offset` 比例分量。
 * start/span = 锚元素的起始列与列跨度，winCol = 窗口起点所在列。
 */
export function anchorOffsetIn(start: number, span: number, winCol: number): number {
  const s = Math.max(1, span);
  const delta = Math.max(0, Math.min(s - 1, winCol - start));
  return delta / s;
}

/**
 * 锚点 → 目标列：起始列 + 比例 × 新排版下的列跨度。
 * 与 anchorOffsetIn 互为逆运算（同一排版下 round 后精确还原，因此重复量取不会漂移）；
 * 旧数据/脏值（offset 不在 (0,1) 内）退化为锚元素起点。
 */
export function anchorTargetCol(start: number, span: number, offset: number): number {
  const s = Math.max(1, span);
  const frac = Number.isFinite(offset) && offset > 0 && offset < 1 ? offset : 0;
  return start + Math.min(s - 1, Math.round(frac * s));
}

/**
 * Range 的第一个**真有几何**的矩形。
 * 空白文本节点（块级元素之间的换行/缩进）不生成布局盒，getBoundingClientRect
 * 全 0；多列换行时 getClientRects 会给出多段，取第一段即视觉起点。
 */
function firstRealRect(range: Range): DOMRect | null {
  for (const r of Array.from(range.getClientRects())) {
    if (r.width || r.height) return r;
  }
  const b = range.getBoundingClientRect();
  return b && (b.width || b.height) ? b : null;
}

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

  const [indicator, setIndicator] = React.useState({ page: 0, total: 1, cols: 1 });
  const metricsRef = React.useRef<Metrics>({ step: 0, colW: 0 });
  const pageRef = React.useRef(0);
  const totalRef = React.useRef(1);
  /** 实测总列数（= 总页数，双页视图一屏两列） */
  const colsRef = React.useRef(1);
  /** 是否已完成过一次量取（未量取时 getPageInfo().pages 返回 0，避免把「1 页」写进书库） */
  const measuredRef = React.useRef(false);
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

  /** 锚元素在多列中的位置：起始列 + 列跨度（跨度用于按比例还原窗口在元素内的位置） */
  const anchorColSpan = React.useCallback((i: number): { start: number; span: number } | null => {
    const ct = contentRef.current;
    if (!ct) return null;
    const el = ct.querySelector<HTMLElement>(`[data-anchor="${i}"]`);
    if (!el) return null;
    const { colW } = metricsRef.current;
    if (colW <= 0) return null;
    // 下一个「起点更靠后」的锚元素即本元素的结束边界（末元素用内容总宽）
    let nextLeft = -1;
    let seen = false;
    for (const other of ct.querySelectorAll<HTMLElement>('[data-anchor]')) {
      if (other === el) {
        seen = true;
        continue;
      }
      if (seen && other.offsetLeft > el.offsetLeft) {
        nextLeft = other.offsetLeft;
        break;
      }
    }
    const start = columnIndexAt(el.offsetLeft, colW);
    const end = columnIndexAt(nextLeft >= 0 ? nextLeft : ct.scrollWidth, colW);
    return { start, span: Math.max(1, end - start) };
  }, []);

  /** 捕获当前窗口起点的锚点（窗口左缘经过的最后一个锚元素 + 元素内比例位置） */
  const captureAnchor = React.useCallback((): ReadingAnchor | null => {
    const ct = contentRef.current;
    if (!ct) return null;
    const { colW, step } = metricsRef.current;
    const x = pageRef.current * step;
    let best: { i: number; x: number } | null = null;
    let nextX = -1;
    for (const el of ct.querySelectorAll<HTMLElement>('[data-anchor]')) {
      const i = Number(el.dataset.anchor);
      if (!Number.isInteger(i) || i < 0) continue;
      if (el.offsetLeft <= x + 4) {
        if (!best || el.offsetLeft >= best.x) best = { i, x: el.offsetLeft };
      } else {
        nextX = el.offsetLeft; // 内容按文档顺序排列，offsetLeft 单调
        break;
      }
    }
    if (!best) {
      const first = ct.querySelector<HTMLElement>('[data-anchor]');
      return first ? { index: Number(first.dataset.anchor) || 0, offset: 0 } : null;
    }
    if (colW <= 0) return { index: best.i, offset: 0 };
    const start = columnIndexAt(best.x, colW);
    const end = columnIndexAt(nextX >= 0 ? nextX : ct.scrollWidth, colW);
    return {
      index: best.i,
      offset: anchorOffsetIn(start, end - start, columnIndexAt(x, colW)),
    };
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
      const pos = anchorColSpan(restoreFrom.index);
      if (pos) {
        // 锚元素起始列 + 元素内比例位置（比例见 ReadingAnchor 注释：只记起始列会
        // 把画面拽回锚元素起点，长章节里就是倒退好几屏）
        const target = Math.min(cols - 1, anchorTargetCol(pos.start, pos.span, restoreFrom.offset));
        nextPage = Math.min(pages - 1, Math.floor(target / columns));
      }
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
      colsRef.current !== cols ||
      reportedRef.current?.page !== nextPage;

    totalRef.current = pages;
    colsRef.current = cols;
    pageRef.current = nextPage;
    measuredRef.current = true;
    applyTransform();
    // 锚点随新位置更新（下一次重排按内容位置恢复，而不是按比例跳变）
    anchorRef.current = captureAnchor();

    if (changed) {
      setIndicator({ page: nextPage, total: pages, cols });
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
      setIndicator({ page: clamped, total: totalRef.current, cols: colsRef.current });
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
      goToPage(Math.floor(columnIndexAt(el.offsetLeft, colW) / columns));
    },
    [columns, goToPage]
  );

  /**
   * 文本偏移 → 所在页：在 rootSelector 容器内按 TreeWalker 累计文本长度定位到
   * 第 offset 个字符，用 Range 包围盒反推所在列。
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

      const rectAt = (node: Text, off: number): DOMRect | null => {
        const range = document.createRange();
        const startOff = Math.min(off, node.length);
        range.setStart(node, startOff);
        // 折叠 Range 的包围盒可能为 0，多包一个字符保证有几何信息
        range.setEnd(node, Math.min(startOff + 1, node.length));
        return firstRealRect(range);
      };

      // 偏移可能正好落在**空白文本节点**上（块级元素之间的 "\n"/缩进——选区起点
      // 常被浏览器放在这里）。这类节点不生成布局盒，取到的 rect 全 0；旧代码用
      // `rect.left || ctRect.left` 兜底，等于把 0 当成有效坐标 → 一律跳到第 0 页
      // （封面）。这里改为沿文档顺序往后找第一个真有几何的文本节点。
      let rect = rectAt(target, targetOff);
      let guard = 0;
      while (!rect && guard++ < 500 && walker.nextNode()) {
        const node = walker.currentNode as Text;
        if (!node.data?.length) continue;
        rect = rectAt(node, 0);
      }

      const { colW, step } = metricsRef.current;
      if (colW <= 0 || step <= 0) return;
      // rect 与 ctRect 都是应用位移后的屏幕坐标，二者相减已抵消 translateX，
      // 结果即内容流坐标（此处不能再加回当前位移，否则跳转目标随当前页漂移）；
      // 整章都没有几何（隐藏章节等）时退回章节起点，绝不静默落到第 0 页
      const xRaw = rect
        ? rect.left - ct.getBoundingClientRect().left
        : (root as HTMLElement).offsetLeft;
      goToPage(Math.floor(columnIndexAt(xRaw, colW) / columns));
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
    /** 实测总页数（= 总列数）：底部页码显示与落盘 totalPages 都用它 */
    pages: indicator.cols,
    next,
    prev,
    goToPage,
    goToElement,
    goToTextOffset,
    goToPercent,
    getAnchor: () => anchorRef.current,
    getPageInfo: (): PageInfo => ({
      spread: pageRef.current,
      spreads: totalRef.current,
      pages: measuredRef.current ? colsRef.current : 0,
      firstPage: Math.min(colsRef.current, pageRef.current * columns + 1),
    }),
  };
}
