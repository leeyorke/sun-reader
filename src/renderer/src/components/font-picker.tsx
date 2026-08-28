/**
 * FontPicker - 系统字体选择器（设置页「阅读设置」用）
 *
 * 触发按钮显示当前字体（按其实际字体预览）；面板顶部搜索框过滤，
 * 列表 = 3 个默认字体栈（衬线/无衬线/等宽）+ 系统已装字体（按 family 名
 * 去重、字母序，每项以自身字体预览）。系统字体超过 80 款时提示继续搜索。
 * fontFamily 存储值为：FONT_FAMILIES 的键 或 系统 family 名（prefs.ts 负责解析）。
 */

import * as React from 'react';
import { ChevronDown } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FONT_FAMILIES } from '@/lib/constants';
import { cn } from '@/lib/utils';
import { resolveFontFamily } from '@/lib/prefs';
import { useSystemFonts } from '@/hooks/useSystemFonts';

const MAX_VISIBLE = 80;

interface FontPickerProps {
  value: string;
  onChange: (value: string) => void;
}

export function FontPicker({ value, onChange }: FontPickerProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState('');
  const rootRef = React.useRef<HTMLDivElement>(null);
  const { fonts, loading, error } = useSystemFonts(open);

  // 点击面板外部关闭
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const q = query.trim().toLowerCase();
  const matched = q ? fonts.filter((f) => f.toLowerCase().includes(q)) : fonts;
  const visible = matched.slice(0, MAX_VISIBLE);
  const labelOf = (v: string) => FONT_FAMILIES.find((f) => f.value === v)?.label ?? v;

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <Button
        variant="outline"
        className="w-[200px] justify-between font-normal"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="truncate" style={{ fontFamily: resolveFontFamily(value) }}>
          {labelOf(value)}
        </span>
        <ChevronDown className="h-4 w-4 opacity-60 shrink-0" />
      </Button>

      {open && (
        <div className="absolute z-20 mt-1 w-[280px] rounded-lg border border-border bg-popover text-popover-foreground shadow-xl overflow-hidden">
          <div className="p-2 border-b border-border">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索系统字体..."
              className="w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>
          <div className="max-h-72 overflow-y-auto p-1">
            {!q &&
              FONT_FAMILIES.map((g) => (
                <button
                  key={g.value}
                  onClick={() => pick(g.value)}
                  className={cn(
                    'w-full flex items-center justify-between text-left text-sm px-2.5 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors',
                    value === g.value && 'bg-primary/10 text-primary'
                  )}
                >
                  <span className="truncate" style={{ fontFamily: g.family }}>
                    {g.label}
                  </span>
                  <span className="text-[10px] text-muted-foreground shrink-0 ml-2">默认</span>
                </button>
              ))}

            {loading ? (
              <p className="text-xs text-muted-foreground px-2.5 py-2">正在读取系统字体...</p>
            ) : error ? (
              <p className="text-xs text-muted-foreground px-2.5 py-2">{error}，仅可使用默认字体。</p>
            ) : (
              <>
                {!q && (
                  <p className="px-2.5 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                    系统字体（{fonts.length}）
                  </p>
                )}
                {visible.map((f) => (
                  <button
                    key={f}
                    title={f}
                    onClick={() => pick(f)}
                    className={cn(
                      'w-full text-left text-sm px-2.5 py-1.5 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors truncate',
                      value === f && 'bg-primary/10 text-primary'
                    )}
                    style={{ fontFamily: `'${f}', serif` }}
                  >
                    {f}
                  </button>
                ))}
                {visible.length === 0 && (
                  <p className="text-xs text-muted-foreground px-2.5 py-2">无匹配字体</p>
                )}
                {matched.length > visible.length && (
                  <p className="text-xs text-muted-foreground px-2.5 py-1.5">
                    匹配 {matched.length} 款，仅显示前 {MAX_VISIBLE} 款，请输入关键词筛选
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
