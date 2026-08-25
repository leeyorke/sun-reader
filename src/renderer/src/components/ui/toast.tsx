/**
 * 轻量 Toast 通知（无外部依赖）
 * 用法：import { toast } from '@/components/ui/toast'; toast({ title: '成功' })
 */

import * as React from 'react';
import { cn } from '@/lib/utils';

export interface ToastItem {
  id: number;
  title?: string;
  description?: string;
  variant?: 'default' | 'destructive';
}

type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let listeners: Listener[] = [];
let nextId = 1;

function emit() {
  listeners.forEach((l) => l(items));
}

export function toast(t: Omit<ToastItem, 'id'>) {
  const item: ToastItem = { ...t, id: nextId++ };
  items = [...items, item];
  emit();
  window.setTimeout(() => {
    items = items.filter((i) => i.id !== item.id);
    emit();
  }, 3200);
}

export function Toaster() {
  const [list, setList] = React.useState<ToastItem[]>([]);

  React.useEffect(() => {
    listeners.push(setList);
    return () => {
      listeners = listeners.filter((l) => l !== setList);
    };
  }, []);

  if (list.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-[2000] flex flex-col gap-2 w-80">
      {list.map((item) => (
        <div
          key={item.id}
          className={cn(
            'rounded-lg border bg-popover text-popover-foreground shadow-lg px-4 py-3 animate-in fade-in slide-in-from-bottom-2',
            item.variant === 'destructive'
              ? 'border-destructive/50'
              : 'border-border'
          )}
        >
          {item.title && (
            <p className="text-sm font-semibold leading-none mb-1">{item.title}</p>
          )}
          {item.description && (
            <p className="text-sm text-muted-foreground">{item.description}</p>
          )}
        </div>
      ))}
    </div>
  );
}
