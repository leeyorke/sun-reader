/**
 * 分页定位回归测试（真实事故）
 *
 * 1. columnIndexAt：坐标 → 列号。旧代码用 Math.round，把「列的后半段」算进下一列，
 *    双页模式下就是整屏跳错一页。
 * 2. trimRangeWhitespace：浏览器常把选区起点放在块级元素之间的空白文本节点上，
 *    存下的划线区间起点因此落在**不生成布局盒**的节点上；跳转按偏移取 Range
 *    矩形时拿到全 0，旧代码 `rect.left || ctRect.left` 把 0 当有效坐标 →
 *    《数据密集型应用系统设计》里三条批注全部跳到封面页。
 */

import { describe, it, expect } from 'vitest';

import { columnIndexAt } from '../../src/renderer/src/hooks/useColumnPagination';
import { trimRangeWhitespace } from '../../src/renderer/src/lib/selection';

const COL_W = 675; // 实测：1422px 视口、双列、间距 72
const STEP = COL_W + 72;

describe('columnIndexAt（内容流坐标 → 列号）', () => {
  it('列首坐标落在本列', () => {
    expect(columnIndexAt(0, COL_W)).toBe(0);
    expect(columnIndexAt(STEP, COL_W)).toBe(1);
    expect(columnIndexAt(STEP * 5, COL_W)).toBe(5);
  });

  it('列内任意位置都算本列（旧的 round 会把后半段算进下一列）', () => {
    expect(columnIndexAt(500, COL_W)).toBe(0);
    expect(columnIndexAt(COL_W, COL_W)).toBe(0);
    expect(columnIndexAt(STEP + 1300 - STEP, COL_W)).toBe(1);
    expect(columnIndexAt(1300, COL_W)).toBe(1); // round 会算成 2 → 双页模式跳错一屏
    expect(columnIndexAt(STEP * 3 + COL_W - 1, COL_W)).toBe(3);
  });

  it('吸收列首的亚像素误差，不回退到上一列', () => {
    expect(columnIndexAt(STEP - 0.4, COL_W)).toBe(1);
    expect(columnIndexAt(STEP * 7 - 0.6, COL_W)).toBe(7);
  });

  it('负坐标夹到 0', () => {
    expect(columnIndexAt(-50, COL_W)).toBe(0);
  });
});

describe('trimRangeWhitespace（划线区间挤掉两端空白）', () => {
  const text = '\n    段落一的正文  \n\n  段落二';

  it('起点跳过块级元素之间的空白（换行 + 缩进），终点停在可见字符后', () => {
    // 0='\n'，1-4=缩进，5-10='段落一的正文'，11-12=行尾空格
    expect(trimRangeWhitespace(text, 0, 12)).toEqual({ start: 5, end: 11 });
  });

  it('终点回退到最后一个可见字符', () => {
    // '段落一的正文' 之后是两个空格 + 换行
    const r = trimRangeWhitespace(text, 5, 14);
    expect(r).toEqual({ start: 5, end: 11 });
    expect(text.slice(r!.start, r!.end)).toBe('段落一的正文');
  });

  it('区间内全是空白时返回 null（不存无意义的划线）', () => {
    expect(trimRangeWhitespace(text, 0, 5)).toBeNull();
    expect(trimRangeWhitespace('   ', 0, 3)).toBeNull();
  });

  it('本来就贴着可见字符的区间原样返回', () => {
    expect(trimRangeWhitespace('abcdef', 1, 4)).toEqual({ start: 1, end: 4 });
  });

  it('越界的入参被夹回文本范围', () => {
    expect(trimRangeWhitespace('abc', -3, 99)).toEqual({ start: 0, end: 3 });
  });
});
