/**
 * 分页定位回归测试（真实事故）
 *
 * 1. columnIndexAt：坐标 → 列号。旧代码用 Math.round，把「列的后半段」算进下一列，
 *    双页模式下就是整屏跳错一页。
 * 2. trimRangeWhitespace：浏览器常把选区起点放在块级元素之间的空白文本节点上，
 *    存下的划线区间起点因此落在**不生成布局盒**的节点上；跳转按偏移取 Range
 *    矩形时拿到全 0，旧代码 `rect.left || ctRect.left` 把 0 当有效坐标 →
 *    《数据密集型应用系统设计》里三条批注全部跳到封面页。
 * 3. anchorOffsetIn / anchorTargetCol：阅读锚点的「元素内比例位置」。旧实现只记
 *    锚元素索引（offset 恒 0），于是每次重新量取都把画面拽回锚元素起点——目录
 *    跳到第二章后一次 re-measure 就退回上一章参考文献页（实测 col 66 → col 62），
 *    退出重开也只落回章首。两个方向必须互为逆运算（幂等，不漂移）。
 */

import { describe, it, expect } from 'vitest';

import {
  anchorOffsetIn,
  anchorTargetCol,
  columnIndexAt,
} from '../../src/renderer/src/hooks/useColumnPagination';
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

describe('trimRangeWhitespace（划线区间挤掉两端空白）', () => {  const text = '\n    段落一的正文  \n\n  段落二';

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

describe('阅读锚点的元素内比例位置', () => {
  it('捕获 → 还原 在同一排版下精确幂等（不再每次量取都退回章首）', () => {
    const start = 248;
    const span = 8; // 第五章：col 248…255
    for (let winCol = start; winCol < start + span; winCol++) {
      const off = anchorOffsetIn(start, span, winCol);
      expect(anchorTargetCol(start, span, off)).toBe(winCol);
    }
  });

  it('章首返回 0，且 0 还原为章首', () => {
    expect(anchorOffsetIn(100, 10, 100)).toBe(0);
    expect(anchorTargetCol(100, 10, 0)).toBe(100);
  });

  it('比例落在 [0,1)，绝不指向下一章', () => {
    const off = anchorOffsetIn(10, 4, 13); // 章内最后一列
    expect(off).toBeGreaterThan(0);
    expect(off).toBeLessThan(1);
    expect(anchorTargetCol(10, 4, off)).toBe(13);
  });

  it('改字号后按新的列跨度折算，落点仍在章内（章首/章尾不越界）', () => {
    const off = anchorOffsetIn(248, 8, 252); // 旧排版：章内过半
    expect(anchorTargetCol(1000, 16, off)).toBe(1008); // 新排版章跨度翻倍
    expect(anchorTargetCol(1000, 2, off)).toBe(1001); // 新排版章变短，仍在章内
  });

  it('窗口列在锚元素之前/之后都夹回元素内', () => {
    expect(anchorOffsetIn(50, 5, 20)).toBe(0);
    expect(anchorTargetCol(50, 5, anchorOffsetIn(50, 5, 999))).toBe(54);
  });

  it('旧数据与脏值（offset 不在 (0,1) 内）退化为锚元素起点', () => {
    for (const bad of [0, 1, 3, -0.5, NaN, Infinity]) {
      expect(anchorTargetCol(300, 12, bad)).toBe(300);
    }
  });

  it('span 非法时不会算出 NaN 或负列', () => {
    expect(anchorOffsetIn(10, 0, 10)).toBe(0);
    expect(anchorTargetCol(10, 0, 0.5)).toBe(10);
    expect(anchorTargetCol(10, -3, 0.9)).toBe(10);
  });
});
