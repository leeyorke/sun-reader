/**
 * 划线（下划线批注）选区工具
 *
 * - getSelectionRangeIn：把浏览器选区换算成「锚点索引 + 字符区间」。
 *   TXT 用 data-pidx（段落级）；EPUB 原书渲染用 data-chidx（章节级，
 *   偏移基于整章纯文本，兼容任意 HTML 结构）。跨锚点返回 null（退化为纯批注）。
 * - mergeRanges / segmentParagraph：纯函数，把已保存的划线区间合并、切段，
 *   供正文渲染高亮 span（TXT 路径）。可在 node 环境单测。
 */

export interface UnderlineRange {
  /** 段内字符起点（含） */
  start: number;
  /** 段内字符终点（不含） */
  end: number;
  /** 划线颜色 */
  color: string;
}

export interface SelectionRangeInfo {
  /** 锚点索引：data-pidx（TXT 段落）或 data-chidx（EPUB 章节） */
  anchorIndex: number;
  start: number;
  end: number;
  /** 选中文本（用作 quote） */
  text: string;
  /** 选区包围盒（弹层定位用） */
  rect: DOMRect;
}

export interface TextSegment {
  text: string;
  /** 有值表示该段带划线 */
  color?: string;
}

/** 合并重叠区间；先出现的区间颜色优先。只合并真正重叠的，相邻接的保持独立（各显各色）。 */
export function mergeRanges(ranges: UnderlineRange[]): UnderlineRange[] {
  const sorted = ranges
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: UnderlineRange[] = [];
  for (const r of sorted) {
    const last = merged[merged.length - 1];
    if (last && r.start < last.end) {
      last.end = Math.max(last.end, r.end);
    } else {
      merged.push({ ...r });
    }
  }
  return merged;
}

/** 把段落文本按划线区间切段；越界区间自动裁剪到文本长度。 */
export function segmentParagraph(text: string, ranges: UnderlineRange[]): TextSegment[] {
  const merged = mergeRanges(ranges);
  const segments: TextSegment[] = [];
  let cursor = 0;
  for (const r of merged) {
    const start = Math.max(0, Math.min(r.start, text.length));
    const end = Math.max(0, Math.min(r.end, text.length));
    if (start >= end) continue;
    if (start > cursor) segments.push({ text: text.slice(cursor, start) });
    segments.push({ text: text.slice(start, end), color: r.color });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor) });
  return segments;
}

/**
 * 把区间两端的空白挤掉，使 start 落在真实可见字符上。
 * 浏览器常把选区起点放在块级元素之间的空白文本节点（"\n" + 缩进）上，
 * 那种节点不生成布局盒 —— 存成划线区间后按偏移反查位置会拿到全 0 的矩形，
 * 跳转就会退化到第一页。返回 null 表示区间内全是空白。
 */
export function trimRangeWhitespace(
  text: string,
  start: number,
  end: number
): { start: number; end: number } | null {
  let s = Math.max(0, start);
  let e = Math.min(text.length, end);
  while (s < e && /\s/.test(text[s])) s++;
  while (e > s && /\s/.test(text[e - 1])) e--;
  return e > s ? { start: s, end: e } : null;
}

/**
 * 从当前选区解析划线区间（通用版）。
 * anchorAttr 决定锚点粒度：'data-pidx' = TXT 段落级（段内偏移）；
 * 'data-chidx' = EPUB 章节级（整章纯文本上的字符偏移，兼容任意 HTML 结构）。
 * 偏移计算用 Range.toString() 量长，天然兼容划线内再次划线的嵌套结构，
 * 也兼容起止点落在元素节点上（如三连击整段选中）的情况。
 */
export function getSelectionRangeIn(anchorAttr: 'data-pidx' | 'data-chidx'): SelectionRangeInfo | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const range = sel.getRangeAt(0);

  const resolveAnchor = (node: Node | null): HTMLElement | null => {
    const el =
      node?.nodeType === Node.TEXT_NODE ? node.parentElement : (node as HTMLElement | null);
    return el?.closest<HTMLElement>(`[${anchorAttr}]`) ?? null;
  };

  const startP = resolveAnchor(range.startContainer);
  const endP = resolveAnchor(range.endContainer);
  if (!startP || startP !== endP) return null; // 跨锚点或不在正文内

  const anchorIndex = Number(startP.dataset[anchorAttr === 'data-pidx' ? 'pidx' : 'chidx']);
  if (!Number.isInteger(anchorIndex) || anchorIndex < 0) return null;

  const textOffset = (container: Node, offset: number): number => {
    const probe = document.createRange();
    probe.selectNodeContents(startP);
    try {
      probe.setEnd(container, offset);
    } catch {
      return -1;
    }
    return probe.toString().length;
  };

  const rawStart = textOffset(range.startContainer, range.startOffset);
  const rawEnd = textOffset(range.endContainer, range.endOffset);
  if (rawStart < 0 || rawEnd < 0 || rawEnd <= rawStart) return null;

  const fullText = startP.textContent ?? '';
  const trimmed = trimRangeWhitespace(fullText, rawStart, rawEnd);
  if (!trimmed) return null; // 纯空白选区
  const { start, end } = trimmed;
  const text = fullText.slice(start, end);
  if (!text) return null;

  return { anchorIndex, start, end, text, rect: range.getBoundingClientRect() };
}

/** TXT：段落级划线区间 */
export function getSelectionRange(): SelectionRangeInfo | null {
  return getSelectionRangeIn('data-pidx');
}

/** EPUB：章节级划线区间（整章文本上的偏移） */
export function getSelectionRangeByChapter(): SelectionRangeInfo | null {
  return getSelectionRangeIn('data-chidx');
}
