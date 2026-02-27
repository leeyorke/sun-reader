/**
 * Library Store - 书库状态
 */

import { create } from 'zustand';
import { devtools, persist } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { Book } from '@/lib/types';

interface FilterState {
  search: string;
  format: string | null;
  sortBy: 'addedDate' | 'title' | 'author' | 'progress' | 'lastRead';
  sortOrder: 'asc' | 'desc';
}

interface LibraryState {
  // 书籍数据
  books: Book[];
  collections: Array<{ id: string; name: string; bookIds: string[] }>;

  // 选中的书籍
  selectedBookIds: string[];
  lastSelectedBookId: string | null;

  // 筛选和排序
  filter: FilterState;

  // 加载状态
  isLoading: boolean;
  isImporting: boolean;
  importProgress: number;

  // 错误状态
  error: string | null;
}

interface LibraryActions {
  // 书籍操作
  setBooks: (books: Book[]) => void;
  addBook: (book: Book) => void;
  addBooks: (books: Book[]) => void;
  updateBook: (bookId: string, updates: Partial<Book>) => void;
  removeBook: (bookId: string) => void;
  removeBooks: (bookIds: string[]) => void;

  // 更新阅读进度
  updateBookProgress: (bookId: string, progress: number, currentPage: number) => void;
  updateBookLastRead: (bookId: string, timestamp: string) => void;

  // 选中操作
  selectBook: (bookId: string, isMultiSelect?: boolean) => void;
  deselectBook: (bookId: string) => void;
  selectAll: () => void;
  deselectAll: () => void;

  // 筛选和排序
  setFilter: (filter: Partial<FilterState>) => void;
  setSearchQuery: (query: string) => void;
  setFormatFilter: (format: string | null) => void;
  setSortBy: (sortBy: FilterState['sortBy']) => void;
  toggleSortOrder: () => void;
  resetFilters: () => void;

  // 加载状态
  setIsLoading: (isLoading: boolean) => void;
  setIsImporting: (isImporting: boolean) => void;
  setImportProgress: (progress: number) => void;

  // 错误状态
  setError: (error: string | null) => void;
  clearError: () => void;

  // 获取筛选后的书籍
  getFilteredBooks: () => Book[];
  getSortedBooks: () => Book[];

  // 重置
  reset: () => void;
}

const initialFilter: FilterState = {
  search: '',
  format: null,
  sortBy: 'addedDate',
  sortOrder: 'desc',
};

const initialState: LibraryState = {
  books: [],
  collections: [],
  selectedBookIds: [],
  lastSelectedBookId: null,
  filter: initialFilter,
  isLoading: false,
  isImporting: false,
  importProgress: 0,
  error: null,
};

export const useLibraryStore = create<LibraryState & LibraryActions>()(
  devtools(
    immer((set, get) => ({
      ...initialState,

      // 书籍操作
      setBooks: (books) => set((state) => { state.books = books; }),
      addBook: (book) => set((state) => { state.books.push(book); }),
      addBooks: (books) => set((state) => { state.books.push(...books); }),
      updateBook: (bookId, updates) => set((state) => {
        const book = state.books.find(b => b.id === bookId);
        if (book) Object.assign(book, updates);
      }),
      removeBook: (bookId) => set((state) => {
        state.books = state.books.filter(b => b.id !== bookId);
        state.selectedBookIds = state.selectedBookIds.filter(id => id !== bookId);
      }),
      removeBooks: (bookIds) => set((state) => {
        state.books = state.books.filter(b => !bookIds.includes(b.id));
        state.selectedBookIds = state.selectedBookIds.filter(id => !bookIds.includes(id));
      }),

      // 阅读进度
      updateBookProgress: (bookId, progress, currentPage) => set((state) => {
        const book = state.books.find(b => b.id === bookId);
        if (book) {
          book.readingProgress = progress;
          book.currentPage = currentPage;
        }
      }),
      updateBookLastRead: (bookId, timestamp) => set((state) => {
        const book = state.books.find(b => b.id === bookId);
        if (book) book.lastRead = timestamp;
      }),

      // 选中操作
      selectBook: (bookId, isMultiSelect = false) => set((state) => {
        if (isMultiSelect) {
          if (state.selectedBookIds.includes(bookId)) {
            state.selectedBookIds = state.selectedBookIds.filter(id => id !== bookId);
          } else {
            state.selectedBookIds.push(bookId);
          }
        } else {
          state.selectedBookIds = [bookId];
        }
        state.lastSelectedBookId = bookId;
      }),
      deselectBook: (bookId) => set((state) => {
        state.selectedBookIds = state.selectedBookIds.filter(id => id !== bookId);
      }),
      selectAll: () => set((state) => {
        state.selectedBookIds = state.books.map(b => b.id);
      }),
      deselectAll: () => set((state) => {
        state.selectedBookIds = [];
      }),

      // 筛选和排序
      setFilter: (filter) => set((state) => { Object.assign(state.filter, filter); }),
      setSearchQuery: (query) => set((state) => { state.filter.search = query; }),
      setFormatFilter: (format) => set((state) => { state.filter.format = format; }),
      setSortBy: (sortBy) => set((state) => { state.filter.sortBy = sortBy; }),
      toggleSortOrder: () => set((state) => { state.filter.sortOrder = state.filter.sortOrder === 'asc' ? 'desc' : 'asc'; }),
      resetFilters: () => set((state) => { state.filter = initialFilter; }),

      // 加载状态
      setIsLoading: (isLoading) => set((state) => { state.isLoading = isLoading; }),
      setIsImporting: (isImporting) => set((state) => { state.isImporting = isImporting; }),
      setImportProgress: (progress) => set((state) => { state.importProgress = progress; }),

      // 错误状态
      setError: (error) => set((state) => { state.error = error; }),
      clearError: () => set((state) => { state.error = null; }),

      // 获取筛选后的书籍
      getFilteredBooks: () => {
        const { books, filter } = get();
        return books.filter(book => {
          if (filter.search && !book.title.toLowerCase().includes(filter.search.toLowerCase()) &&
              !book.author.toLowerCase().includes(filter.search.toLowerCase())) {
            return false;
          }
          if (filter.format && book.format !== filter.format) {
            return false;
          }
          return true;
        });
      },

      // 获取排序后的书籍
      getSortedBooks: () => {
        const filtered = get().getFilteredBooks();
        const { sortBy, sortOrder } = get().filter;

        return filtered.sort((a, b) => {
          let comparison = 0;
          switch (sortBy) {
            case 'title':
              comparison = a.title.localeCompare(b.title);
              break;
            case 'author':
              comparison = a.author.localeCompare(b.author);
              break;
            case 'addedDate':
              comparison = new Date(a.addedDate).getTime() - new Date(b.addedDate).getTime();
              break;
            case 'progress':
              comparison = a.readingProgress - b.readingProgress;
              break;
            case 'lastRead':
              const aTime = a.lastRead ? new Date(a.lastRead).getTime() : 0;
              const bTime = b.lastRead ? new Date(b.lastRead).getTime() : 0;
              comparison = aTime - bTime;
              break;
          }
          return sortOrder === 'asc' ? comparison : -comparison;
        });
      },

      // 重置
      reset: () => set(initialState),
    })),
    { name: 'LibraryStore' }
  )
);
