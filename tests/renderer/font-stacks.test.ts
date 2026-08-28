/**
 * 字体栈合法性回归测试
 *
 * 背景（真实事故）：`'Noto Serif SC, Source Serif 4, Georgia, serif'` 里的
 * `Source Serif 4` 没加引号——CSS 不带引号的 font-family 是「标识符序列」，
 * 而 `4` 不是合法标识符，于是整条 font-family 声明被浏览器判为无效并**整条丢弃**。
 * 这个栈被 resolveFontFamily 接在每个用户所选字体后面，导致「无论选什么字体，
 * 正文都继承 html 的无衬线栈、中文显示成微软雅黑」，且 DevTools 里不报错。
 *
 * 因此这里既校验常量里的字体栈，也校验 resolveFontFamily 的输出。
 */

import { describe, it, expect } from 'vitest';

import { FONT_FAMILIES, READER_MONO_FAMILY } from '../../src/renderer/src/lib/constants';
import { quoteFontFamily, resolveFontFamily } from '../../src/renderer/src/lib/prefs';

/** CSS 标识符：不能以数字（或 -数字）开头，不含空白/引号/逗号；中文等非 ASCII 合法 */
const IDENT = /^-?[^\s0-9'",()][^\s'",()]*$/;

/** 校验一个 font-family 值能否被 CSS 解析（不带引号的部分必须是标识符序列） */
function isValidFontFamilyValue(value: string): boolean {
  const parts = value.split(',');
  if (parts.some((p) => !p.trim())) return false;
  return parts.every((part) => {
    const s = part.trim();
    if (/^'(?:[^'\\]|\\.)*'$/.test(s) || /^"(?:[^"\\]|\\.)*"$/.test(s)) return true;
    return s.split(/\s+/).every((ident) => IDENT.test(ident));
  });
}

describe('font-family 值合法性校验器自检', () => {
  it('识别出历史上被静默丢弃的非法栈', () => {
    expect(isValidFontFamilyValue('Noto Serif SC, Source Serif 4, Georgia, serif')).toBe(false);
    expect(isValidFontFamilyValue("'霞鹜文楷', 4 Serif")).toBe(false);
    expect(isValidFontFamilyValue('Georgia, , serif')).toBe(false);
  });

  it('接受合法栈（带引号的多词名 / 纯标识符 / 中文名 / -前缀）', () => {
    expect(isValidFontFamilyValue("'Source Serif 4', Georgia, serif")).toBe(true);
    expect(isValidFontFamilyValue('Inter, system-ui, -apple-system, sans-serif')).toBe(true);
    expect(isValidFontFamilyValue('微软雅黑, SimSun, serif')).toBe(true);
  });
});

describe('内置字体栈', () => {
  it('FONT_FAMILIES 每个栈都是合法 CSS 值', () => {
    for (const f of FONT_FAMILIES) {
      expect(isValidFontFamilyValue(f.family), `${f.value}: ${f.family}`).toBe(true);
    }
  });

  it('阅读页等宽栈是合法 CSS 值', () => {
    expect(isValidFontFamilyValue(READER_MONO_FAMILY)).toBe(true);
  });
});

describe('resolveFontFamily', () => {
  it('generic 键返回对应内置栈', () => {
    for (const f of FONT_FAMILIES) {
      expect(resolveFontFamily(f.value)).toBe(f.family);
    }
  });

  it('系统字体名被引号包裹并置于兜底栈之前', () => {
    const out = resolveFontFamily('LXGW WenKai Mono Screen');
    expect(out.startsWith("'LXGW WenKai Mono Screen', ")).toBe(true);
    expect(out.endsWith(FONT_FAMILIES[0].family)).toBe(true);
  });

  it('任意系统字体名的输出都是合法 CSS 值（含数字/空格/引号/中文）', () => {
    const names = [
      'Source Serif 4',
      '霞鹜文楷等宽 屏幕阅读版',
      '4 Seasons',
      "Bob's Font",
      'Font\\Weird',
      '方正舒体',
    ];
    for (const n of names) {
      const out = resolveFontFamily(n);
      expect(isValidFontFamilyValue(out), `${n} -> ${out}`).toBe(true);
    }
  });

  it('剥离历史存档里拼在家族名后的 Regular 样式词', () => {
    expect(resolveFontFamily('霞鹜文楷等宽 屏幕阅读版 Regular')).toBe(
      `'霞鹜文楷等宽 屏幕阅读版', ${FONT_FAMILIES[0].family}`
    );
  });

  it('空值回落到默认衬线栈', () => {
    expect(resolveFontFamily('')).toBe(FONT_FAMILIES[0].family);
    expect(resolveFontFamily('   ')).toBe(FONT_FAMILIES[0].family);
  });

  it('命中不了的名字也保留（由 CSS 自然回退），不静默丢弃用户选择', () => {
    const out = resolveFontFamily('Zzz No Such Font 12345');
    expect(out.startsWith("'Zzz No Such Font 12345', ")).toBe(true);
  });
});

describe('quoteFontFamily', () => {
  it('转义反斜杠与单引号', () => {
    expect(quoteFontFamily("Bob's")).toBe("'Bob\\'s'");
    expect(quoteFontFamily('A\\B')).toBe("'A\\\\B'");
  });
});
