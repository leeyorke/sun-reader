/**
 * stripOverflowHidden / stripFontFamily 的 CSS 文本改写测试。
 *
 * 背景：Chromium 多列分页对 overflow 非 visible 的盒子不能正常分片——
 * DDIA 每章包在 .section{overflow:hidden} 里导致一章只排一列、其余内容
 * 竖向堆进最后一列被裁（127 列 vs 修复后 1166 列）。所以注入书 CSS 前把
 * hidden 改写为 visible（auto/scroll 保留给代码块横向滚动）。
 */
import { describe, expect, it } from 'vitest';
import { stripFontFamily, stripOverflowHidden } from '../../src/renderer/src/lib/epub';

describe('stripOverflowHidden', () => {
  it('把 overflow:hidden 改写为 visible', () => {
    expect(stripOverflowHidden('.section { overflow: hidden; }')).toBe(
      '.section { overflow: visible; }'
    );
  });

  it('处理 overflow-x / overflow-y 与两值语法', () => {
    expect(stripOverflowHidden('div{overflow-x:hidden}')).toBe('div{overflow-x:visible}');
    expect(stripOverflowHidden('div{overflow-y : HIDDEN;}')).toBe('div{overflow-y : visible;}');
    expect(stripOverflowHidden('div{overflow: hidden auto}')).toBe('div{overflow: visible auto}');
  });

  it('保留 auto / scroll / clip（代码块与滚动容器依赖）', () => {
    const css = 'pre{overflow:auto} .scroller{overflow:scroll} .c{overflow:clip}';
    expect(stripOverflowHidden(css)).toBe(css);
  });

  it('不影响 overflow-wrap 与自定义属性', () => {
    const css = 'p{overflow-wrap:break-word;--my-overflow:hidden}';
    expect(stripOverflowHidden(css)).toBe(css);
  });

  it('同一条规则里只动 hidden，其余声明保留', () => {
    expect(
      stripOverflowHidden('.section{color:#000;overflow:hidden;line-height:1.6;margin:0}')
    ).toBe('.section{color:#000;overflow:visible;line-height:1.6;margin:0}');
  });

  it('多条规则混合处理', () => {
    const css = '.a{overflow:hidden}.b{overflow:auto}.c{overflow-y:hidden}';
    expect(stripOverflowHidden(css)).toBe('.a{overflow:visible}.b{overflow:auto}.c{overflow-y:visible}');
  });
});

describe('stripFontFamily（既有行为回归）', () => {
  it('移除 font-family 声明、保留其余', () => {
    expect(stripFontFamily('.calibre{font-family:"KaiTi",serif;color:red}')).toBe(
      '.calibre{color:red}'
    );
  });
});
