/**
 * 书籍数据 hooks —— react-query 统一管理，导入/删除后自动失效缓存
 */

import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { booksApi } from '@/api/electronApi';
import { toast } from '@/components/ui/toast';
import type { Book } from '@/lib/types';

export const BOOKS_QUERY_KEY = ['books'] as const;

/** 书库列表 */
export function useBooks() {
  return useQuery({
    queryKey: BOOKS_QUERY_KEY,
    queryFn: () => booksApi.getAll(),
    enabled: typeof window !== 'undefined' && !!window.electronAPI,
  });
}

/** 单本书籍 */
export function useBook(bookId: string | undefined) {
  return useQuery({
    queryKey: [...BOOKS_QUERY_KEY, bookId],
    queryFn: () => booksApi.get(bookId!),
    enabled: !!bookId && typeof window !== 'undefined' && !!window.electronAPI,
  });
}

/** 导入书籍（打开系统对话框）；成功提示由 books-imported 订阅统一处理 */
export function useImportBooks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => booksApi.import(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: BOOKS_QUERY_KEY });
    },
    onError: () => toast({ title: '导入失败', variant: 'destructive' }),
  });
}

/** 删除书籍 */
export function useDeleteBook() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (bookId: string) => booksApi.delete(bookId),
    onSuccess: () => qc.invalidateQueries({ queryKey: BOOKS_QUERY_KEY }),
    onError: () => toast({ title: '删除失败', variant: 'destructive' }),
  });
}

/** 书籍封面（data URL；封面不变，永不失效） */
export function useBookCover(bookId: string | undefined) {
  return useQuery({
    queryKey: ['cover', bookId],
    queryFn: () => window.electronAPI!.covers.get(bookId!),
    enabled: !!bookId && typeof window !== 'undefined' && !!window.electronAPI,
    staleTime: Infinity,
  });
}

/**
 * 订阅主进程的 books-imported 广播
 * 覆盖「菜单栏 文件→导入书籍」与「页面按钮」两条导入路径
 */
export function useSubscribeBooksImported() {
  const qc = useQueryClient();
  useEffect(() => {
    if (!window.electronAPI) return;
    window.electronAPI.on('books-imported', (books: Book[]) => {
      qc.invalidateQueries({ queryKey: BOOKS_QUERY_KEY });
      if (books.length > 0) {
        toast({ title: `成功导入 ${books.length} 本书籍` });
      }
    });
    // 应用生命周期内常驻；preload 的 off 需要原始包装引用，此处不适用
  }, [qc]);
}
