/**
 * 渲染层工具函数单元测试（src/renderer/src/lib/utils.ts）
 * 全部为纯函数，node 环境即可；throttle/debounce 用 fake timers 驱动。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  cn,
  throttle,
  debounce,
  formatFileSize,
  formatDate,
  deepClone,
  uniqueArray,
  truncateText,
  toCamelCase,
  toPascalCase,
  isEmptyObject,
  getNestedValue,
} from '../../src/renderer/src/lib/utils';

describe('cn（类名合并）', () => {
  it('拼接多段类名并跳过假值', () => {
    expect(cn('a', 'b', false && 'c', undefined, 'd')).toBe('a b d');
  });

  it('tailwind 冲突类以后者为准', () => {
    expect(cn('p-2', 'px-4')).toBe('p-2 px-4');
    expect(cn('p-2', 'p-4')).toBe('p-4');
    expect(cn('text-sm text-red-500', 'text-lg')).toBe('text-red-500 text-lg');
  });
});

describe('throttle（节流）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('窗口内首次立即执行，其余合并为一次尾随调用', () => {
    const fn = vi.fn();
    const t = throttle(fn, 100);

    t(); // 立即执行
    t();
    t();
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(100); // 尾随执行一次
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('冷却期结束后可再次立即执行', () => {
    const fn = vi.fn();
    const t = throttle(fn, 100);

    t();
    vi.advanceTimersByTime(150);
    t();
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('debounce（防抖）', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('停止触发后才执行，且只执行最后一次的参数', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100);

    d('a');
    vi.advanceTimersByTime(50);
    d('b');
    vi.advanceTimersByTime(50);
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('b');
  });

  it('immediate 模式首次同步执行', () => {
    const fn = vi.fn();
    const d = debounce(fn, 100, true);

    d('x');
    expect(fn).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(200);
    d('y'); // 冷却已过，再次立即执行
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('formatFileSize', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [1024, '1 KB'],
    [1536, '1.5 KB'],
    [1024 * 1024, '1 MB'],
    [5 * 1024 * 1024 + 300 * 1024, '5.29 MB'],
  ])('%i 字节 → %s', (bytes, expected) => {
    expect(formatFileSize(bytes as number)).toBe(expected);
  });
});

describe('formatDate', () => {
  it('支持字符串与 Date 输入，默认 yyyy-MM-dd', () => {
    expect(formatDate(new Date(2026, 7, 24))).toBe('2026-08-24');
    expect(formatDate('2026-01-05T03:04:05')).toBe('2026-01-05');
  });

  it('支持自定义格式', () => {
    const d = new Date(2026, 11, 31, 23, 59, 9);
    expect(formatDate(d, 'yyyy/MM/dd HH:mm:ss')).toBe('2026/12/31 23:59:09');
  });
});

describe('deepClone', () => {
  it('嵌套对象克隆后互不影响', () => {
    const src = { a: { b: 1 }, list: [1, { c: 2 }] };
    const out = deepClone(src);
    expect(out).toEqual(src);
    expect(out).not.toBe(src);
    out.a.b = 99;
    out.list[1].c = 77;
    expect(src.a.b).toBe(1);
    expect((src.list[1] as { c: number }).c).toBe(2);
  });

  it('Date 克隆为值相等的新实例', () => {
    const d = new Date('2026-08-24T00:00:00Z');
    const out = deepClone(d);
    expect(out).not.toBe(d);
    expect((out as unknown as Date).getTime()).toBe(d.getTime());
  });

  it('原始类型直接返回', () => {
    expect(deepClone(42)).toBe(42);
    expect(deepClone(null)).toBe(null);
    expect(deepClone('s')).toBe('s');
  });
});

describe('uniqueArray / truncateText / 命名转换', () => {
  it('uniqueArray 去重保序', () => {
    expect(uniqueArray([3, 1, 3, 2, 1])).toEqual([3, 1, 2]);
  });

  it('truncateText 超长截断加省略号', () => {
    expect(truncateText('短文本', 10)).toBe('短文本');
    expect(truncateText('abcdefghij', 8)).toBe('abcde...');
  });

  it('toCamelCase / toPascalCase', () => {
    expect(toCamelCase('foo-bar')).toBe('fooBar');
    expect(toCamelCase('foo_bar_baz')).toBe('fooBarBaz');
    expect(toPascalCase('foo-bar')).toBe('FooBar');
  });
});

describe('isEmptyObject / getNestedValue', () => {
  it('isEmptyObject 判空', () => {
    expect(isEmptyObject({})).toBe(true);
    expect(isEmptyObject({ a: 1 })).toBe(false);
  });

  it('getNestedValue 取值、缺省与中间 null', () => {
    const obj = { a: { b: { c: 1 } } };
    expect(getNestedValue(obj, 'a.b.c')).toBe(1);
    expect(getNestedValue(obj, 'a.x.c')).toBeUndefined();
    expect(getNestedValue<number>(obj, 'a.x.c', 9)).toBe(9);
    expect(getNestedValue({ a: null }, 'a.b', 'fallback')).toBe('fallback');
  });
});
