/**
 * SearchModal - 正文搜索弹窗
 * 行为对齐设计稿 app.js searchManager：输入节流搜索 → 高亮匹配 → 点击跳转并脉冲高亮
 */

import * as React from 'react';
import { X } from 'lucide-react';
import { SEARCH_DEBOUNCE } from '@/lib/constants';

interface SearchModalProps {
  open: boolean;
  onClose: () => void;
  /** 全部文本单元（TXT=正文块 / EPUB=章） */
  paragraphs: string[];
  /** 点击结果：跳到对应文本单元；matchOffset = 命中词在单元内的字符偏移 */
  onJumpTo: (paragraphIndex: number, matchOffset: number) => void;
}

export function SearchModal({ open, onClose, paragraphs, onJumpTo }: SearchModalProps) {
  const [query, setQuery] = React.useState('');
  const [results, setResults] = React.useState<number[]>([]);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const timerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 80);
    } else {
      setQuery('');
      setResults([]);
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      const q = query.trim().toLowerCase();
      if (!q) {
        setResults([]);
        return;
      }
      const matched: number[] = [];
      paragraphs.forEach((text, idx) => {
        if (text.toLowerCase().includes(q)) matched.push(idx);
      });
      setResults(matched.slice(0, 50));
    }, SEARCH_DEBOUNCE);
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [query, open, paragraphs]);

  if (!open) return null;

  /** 命中词在文本单元内的偏移（跳转定位用） */
  const matchOffsetOf = (idx: number): number => {
    const q = query.trim().toLowerCase();
    if (!q) return 0;
    return Math.max(0, (paragraphs[idx] ?? '').toLowerCase().indexOf(q));
  };
  const jumpTo = (idx: number) => {
    onJumpTo(idx, matchOffsetOf(idx));
    onClose();
  };

  const highlight = (text: string) => {
    const q = query.trim();
    if (!q) return text;
    const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'));
    return parts.map((part, i) =>
      part.toLowerCase() === q.toLowerCase() ? (
        <mark key={i} className="bg-primary/20 text-primary rounded-sm px-0.5">
          {part}
        </mark>
      ) : (
        part
      )
    );
  };

  return (
    <div
      className="fixed inset-0 z-[1500] bg-black/50 backdrop-blur-sm flex items-start justify-center pt-24"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-xl max-h-[70vh] mx-4 rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.stopPropagation();
                onClose();
              }
              if (e.key === 'Enter' && results.length > 0) {
                jumpTo(results[0]);
              }
            }}
            placeholder="搜索内容..."
            autoComplete="off"
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
          />
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {query.trim() === '' ? null : results.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-10">
              未找到相关内容
            </p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground px-2 pb-2">
                {results.length} 个匹配段落
              </p>
              <ul className="space-y-1">
                {results.map((idx) => (
                  <li key={idx}>
                    <button
                      className="w-full text-left text-sm leading-relaxed rounded-md px-3 py-2.5 hover:bg-accent hover:text-accent-foreground transition-colors line-clamp-3"
                      onClick={() => jumpTo(idx)}
                    >
                      {highlight(paragraphs[idx])}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
