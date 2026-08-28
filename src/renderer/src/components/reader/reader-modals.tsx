/**
 * 阅读器弹窗三件套：目录 / 书签 / 我的批注
 * 由 dock 栏对应按钮唤起，点击条目跳转到分页器的对应位置。
 * 均基于 ReaderModalShell（遮罩 + 居中卡片 + 标题栏），Esc 由 ReaderPage 统一处理。
 */

import * as React from 'react';
import { BookMarked, ListTree, StickyNote, Trash2, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Bookmark, Note, TocItem } from '@/lib/types';

// ========================================
// 通用外壳
// ========================================

interface ReaderModalShellProps {
  title: string;
  icon: React.ReactNode;
  count?: number;
  onClose: () => void;
  children: React.ReactNode;
}

export function ReaderModalShell({ title, icon, count, onClose, children }: ReaderModalShellProps) {
  return (
    <div
      className="fixed inset-0 z-[1500] bg-black/50 backdrop-blur-sm flex items-center justify-center p-6"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-md max-h-[72vh] rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border shrink-0">
          <span className="text-primary">{icon}</span>
          <h3 className="text-sm font-semibold flex-1">
            {title}
            {typeof count === 'number' && (
              <span className="ml-1.5 text-xs font-normal text-muted-foreground tabular-nums">
                ({count})
              </span>
            )}
          </h3>
          <button
            onClick={onClose}
            title="关闭"
            className="w-8 h-8 rounded-full flex items-center justify-center text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">{children}</div>
      </div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="text-center text-sm text-muted-foreground py-10">{text}</p>;
}

// ========================================
// 目录
// ========================================

interface TocModalProps {
  open: boolean;
  onClose: () => void;
  toc: TocItem[];
  currentChapter: string;
  /** 点击章节：跳到对应段落所在页 */
  onJumpToParagraph: (paragraphIndex: number) => void;
}

export function TocModal({ open, onClose, toc, currentChapter, onJumpToParagraph }: TocModalProps) {
  if (!open) return null;
  return (
    <ReaderModalShell title="目录" icon={<ListTree className="h-4 w-4" />} onClose={onClose}>
      {toc.length === 0 ? (
        <EmptyHint text="未识别到章节结构" />
      ) : (
        <ul className="space-y-0.5">
          {toc.map((t, i) => (
            <li key={i}>
              <button
                className={cn(
                  'w-full text-left text-sm px-3 py-2 rounded-md truncate transition-colors',
                  currentChapter === t.title
                    ? 'bg-primary/10 text-primary font-medium'
                    : 'hover:bg-accent hover:text-accent-foreground'
                )}
                title={t.title}
                onClick={() => {
                  onJumpToParagraph(t.position);
                  onClose();
                }}
              >
                {t.title}
              </button>
            </li>
          ))}
        </ul>
      )}
    </ReaderModalShell>
  );
}

// ========================================
// 书签列表
// ========================================

interface BookmarksModalProps {
  open: boolean;
  onClose: () => void;
  bookmarks: Bookmark[];
  /** 点击书签：按百分比跳页 */
  onJumpToPercent: (pct: number) => void;
  onDelete: (bookmark: Bookmark) => void;
}

export function BookmarksModal({
  open,
  onClose,
  bookmarks,
  onJumpToPercent,
  onDelete,
}: BookmarksModalProps) {
  if (!open) return null;
  return (
    <ReaderModalShell
      title="书签"
      icon={<BookMarked className="h-4 w-4" />}
      count={bookmarks.length}
      onClose={onClose}
    >
      {bookmarks.length === 0 ? (
        <EmptyHint text="暂无书签，点击 dock 栏的书签按钮即可在当前位置添加。" />
      ) : (
        <ul className="space-y-1">
          {[...bookmarks]
            .sort((a, b) => a.position - b.position)
            .map((bm) => (
              <li key={bm.id} className="group flex items-center gap-1">
                <button
                  className="flex-1 text-left text-sm px-3 py-2 rounded-md hover:bg-accent hover:text-accent-foreground transition-colors truncate"
                  title={bm.chapter || `第 ${bm.position}%`}
                  onClick={() => {
                    onJumpToPercent(bm.position);
                    onClose();
                  }}
                >
                  <span className="tabular-nums">{bm.position}%</span>
                  {bm.chapter && <span className="text-muted-foreground"> · {bm.chapter}</span>}
                </button>
                <button
                  className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive p-1.5 transition-opacity"
                  title="删除书签"
                  onClick={() => onDelete(bm)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
        </ul>
      )}
    </ReaderModalShell>
  );
}

// ========================================
// 我的批注（含划线）
// ========================================

interface NotesModalProps {
  open: boolean;
  onClose: () => void;
  notes: Note[];
  /** 点击批注：有段落定位走段落跳转，否则按百分比 */
  onJumpToNote: (note: Note) => void;
  onDelete: (note: Note) => void;
}

export function NotesModal({ open, onClose, notes, onJumpToNote, onDelete }: NotesModalProps) {
  if (!open) return null;
  return (
    <ReaderModalShell
      title="我的批注"
      icon={<StickyNote className="h-4 w-4" />}
      count={notes.length}
      onClose={onClose}
    >
      {notes.length === 0 ? (
        <EmptyHint text="选中正文文字即可划线或添加批注。" />
      ) : (
        <ul className="space-y-2">
          {[...notes]
            .sort((a, b) => a.position - b.position)
            .map((n) => (
              <li key={n.id} className="group relative rounded-lg border border-border p-3">
                <button
                  className="w-full text-left"
                  title="跳转到此处"
                  onClick={() => {
                    onJumpToNote(n);
                    onClose();
                  }}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <span
                      className="w-2 h-2 rounded-full inline-block shrink-0"
                      style={{ background: n.color }}
                    />
                    <span className="text-[11px] text-muted-foreground">
                      {n.type === 'underline' ? '划线' : '批注'} · {n.position}%
                    </span>
                  </div>
                  {n.quote && (
                    <p className="text-xs text-muted-foreground italic line-clamp-2 mb-1">
                      "{n.quote}"
                    </p>
                  )}
                  {n.content && <p className="text-sm leading-snug line-clamp-3">{n.content}</p>}
                </button>
                <button
                  className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                  title="删除批注"
                  onClick={() => onDelete(n)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
        </ul>
      )}
    </ReaderModalShell>
  );
}
