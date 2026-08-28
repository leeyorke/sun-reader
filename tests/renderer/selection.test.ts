/**
 * 划线选区纯函数单元测试（src/renderer/src/lib/selection.ts）
 * 仅覆盖 mergeRanges / segmentParagraph；DOM 依赖的 getSelectionRange 不在 node 环境测试。
 */

import { describe, it, expect } from 'vitest';

import { mergeRanges, segmentParagraph } from '../../src/renderer/src/lib/selection';

describe('mergeRanges（划线区间合并）', () => {
  it('过滤空区间', () => {
    expect(mergeRanges([{ start: 3, end: 3, color: '#f00' }])).toEqual([]);
    expect(mergeRanges([{ start: 5, end: 2, color: '#f00' }])).toEqual([]);
  });

  it('不重叠的区间保持原序与各自颜色', () => {
    const ranges = [
      { start: 10, end: 15, color: '#f00' },
      { start: 0, end: 4, color: '#0f0' },
    ];
    expect(mergeRanges(ranges)).toEqual([
      { start: 0, end: 4, color: '#0f0' },
      { start: 10, end: 15, color: '#f00' },
    ]);
  });

  it('重叠区间合并且保留先出现区间的颜色', () => {
    const ranges = [
      { start: 0, end: 6, color: '#f00' },
      { start: 4, end: 10, color: '#0f0' },
    ];
    expect(mergeRanges(ranges)).toEqual([{ start: 0, end: 10, color: '#f00' }]);
  });

  it('包含关系合并为外层区间', () => {
    const ranges = [
      { start: 2, end: 5, color: '#0f0' },
      { start: 0, end: 10, color: '#f00' },
    ];
    expect(mergeRanges(ranges)).toEqual([{ start: 0, end: 10, color: '#f00' }]);
  });

  it('相邻接（不重叠）的区间不合并，各显各色', () => {
    const ranges = [
      { start: 0, end: 4, color: '#f00' },
      { start: 4, end: 8, color: '#0f0' },
    ];
    expect(mergeRanges(ranges)).toEqual([
      { start: 0, end: 4, color: '#f00' },
      { start: 4, end: 8, color: '#0f0' },
    ]);
  });

  it('乱序输入与多段混合', () => {
    const ranges = [
      { start: 20, end: 24, color: '#00f' },
      { start: 8, end: 12, color: '#f00' },
      { start: 10, end: 15, color: '#0f0' },
      { start: 0, end: 3, color: '#ff0' },
    ];
    expect(mergeRanges(ranges)).toEqual([
      { start: 0, end: 3, color: '#ff0' },
      { start: 8, end: 15, color: '#f00' },
      { start: 20, end: 24, color: '#00f' },
    ]);
  });
});

describe('segmentParagraph（段落高亮切段）', () => {
  const T = '零一二三四五六七八九十';

  it('无划线时整段原样返回', () => {
    expect(segmentParagraph(T, [])).toEqual([{ text: T }]);
  });

  it('中段划线切成三段', () => {
    const segs = segmentParagraph(T, [{ start: 2, end: 5, color: '#f00' }]);
    expect(segs).toEqual([
      { text: '零一' },
      { text: '二三四', color: '#f00' },
      { text: '五六七八九十' },
    ]);
  });

  it('整段划线', () => {
    const segs = segmentParagraph(T, [{ start: 0, end: T.length, color: '#0f0' }]);
    expect(segs).toEqual([{ text: T, color: '#0f0' }]);
  });

  it('越界区间裁剪到文本长度', () => {
    const segs = segmentParagraph('abc', [{ start: 1, end: 99, color: '#f00' }]);
    expect(segs).toEqual([{ text: 'a' }, { text: 'bc', color: '#f00' }]);
  });

  it('起点越界的区间被丢弃', () => {
    const segs = segmentParagraph('abc', [{ start: 5, end: 9, color: '#f00' }]);
    expect(segs).toEqual([{ text: 'abc' }]);
  });

  it('重叠划线合并后切段', () => {
    const segs = segmentParagraph(T, [
      { start: 0, end: 4, color: '#f00' },
      { start: 2, end: 6, color: '#0f0' },
    ]);
    // 合并后区间 [0,6) → '零一二三四五'（6 字，先出现区间的颜色）
    expect(segs).toEqual([
      { text: '零一二三四五', color: '#f00' },
      { text: '六七八九十' },
    ]);
  });

  it('两段不重叠划线之间保留普通文本', () => {
    const segs = segmentParagraph(T, [
      { start: 0, end: 2, color: '#f00' },
      { start: 5, end: 7, color: '#0f0' },
    ]);
    expect(segs).toEqual([
      { text: '零一', color: '#f00' },
      { text: '二三四' },
      { text: '五六', color: '#0f0' },
      { text: '七八九十' },
    ]);
  });

  it('拼接还原后与原文一致（随机性 sanity）', () => {
    for (const ranges of [
      [{ start: 1, end: 3, color: '#f00' }],
      [
        { start: 0, end: 11, color: '#f00' },
        { start: 4, end: 6, color: '#0f0' },
      ],
    ]) {
      const joined = segmentParagraph(T, ranges).map((s) => s.text).join('');
      expect(joined).toBe(T);
    }
  });
});
