/**
 * Reader Store - 阅读器状态
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import type { Book, TocItem } from '@/lib/types';

interface ReaderState {
  // 当前书籍
  currentBook: Book | null;
  currentBookId: string | null;

  // 内容状态
  currentContent: string;
  currentChapter: string;
  toc: TocItem[];

  // 阅读位置
  currentPage: number;
  totalPages: number;
  progress: number;
  currentPosition: number;
  totalLength: number;

  // 阅读设置
  fontSize: number;
  lineHeight: number;
  pageMargins: number;
  fontFamily: string;

  // 视图状态
  isFullscreen: boolean;
  isToolbarVisible: boolean;
  isSidebarOpen: boolean;
  showProgressBar: boolean;

  // 搜索状态
  searchQuery: string;
  searchResults: Array<{ position: number; text: string }>;
  currentSearchIndex: number;
  isSearching: boolean;

  // 批注状态
  selectedText: string;
  selectionPosition: { x: number; y: number } | null;
  isAnnotationMode: boolean;
  showAnnotationPanel: boolean;

  // 加载状态
  isLoading: boolean;
  isRendering: boolean;
  error: string | null;
}

interface ReaderActions {
  // 书籍操作
  setCurrentBook: (book: Book | null) => void;
  setCurrentBookId: (bookId: string | null) => void;

  // 内容操作
  setCurrentContent: (content: string) => void;
  setCurrentChapter: (chapter: string) => void;
  setToc: (toc: TocItem[]) => void;

  // 位置操作
  setCurrentPage: (page: number) => void;
  setTotalPages: (pages: number) => void;
  setProgress: (progress: number) => void;
  setCurrentPosition: (position: number) => void;
  setTotalLength: (length: number) => void;
  goToPage: (page: number) => void;
  goToNextPage: () => void;
  goToPrevPage: () => void;
  goToPosition: (position: number) => void;

  // 设置操作
  setFontSize: (size: number) => void;
  increaseFontSize: () => void;
  decreaseFontSize: () => void;
  setLineHeight: (height: number) => void;
  setPageMargins: (margins: number) => void;
  setFontFamily: (family: string) => void;

  // 视图操作
  toggleFullscreen: () => void;
  toggleToolbar: () => void;
  toggleSidebar: () => void;
  setToolbarVisible: (visible: boolean) => void;
  setSidebarOpen: (open: boolean) => void;
  toggleProgressBar: () => void;

  // 搜索操作
  setSearchQuery: (query: string) => void;
  setSearchResults: (results: Array<{ position: number; text: string }>) => void;
  setCurrentSearchIndex: (index: number) => void;
  goToNextSearchResult: () => void;
  goToPrevSearchResult: () => void;
  clearSearch: () => void;
  setIsSearching: (isSearching: boolean) => void;

  // 批注操作
  setSelectedText: (text: string) => void;
  setSelectionPosition: (position: { x: number; y: number } | null) => void;
  clearSelection: () => void;
  toggleAnnotationMode: () => void;
  toggleAnnotationPanel: () => void;
  setAnnotationPanelOpen: (open: boolean) => void;

  // 状态操作
  setIsLoading: (loading: boolean) => void;
  setIsRendering: (rendering: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  reset: () => void;
}

const initialState: ReaderState = {
  currentBook: null,
  currentBookId: null,
  currentContent: '',
  currentChapter: '',
  toc: [],
  currentPage: 1,
  totalPages: 1,
  progress: 0,
  currentPosition: 0,
  totalLength: 0,
  fontSize: 18,
  lineHeight: 1.75,
  pageMargins: 24,
  fontFamily: 'serif',
  isFullscreen: false,
  isToolbarVisible: true,
  isSidebarOpen: false,
  showProgressBar: true,
  searchQuery: '',
  searchResults: [],
  currentSearchIndex: 0,
  isSearching: false,
  selectedText: '',
  selectionPosition: null,
  isAnnotationMode: false,
  showAnnotationPanel: false,
  isLoading: false,
  isRendering: false,
  error: null,
};

export const useReaderStore = create<ReaderState & ReaderActions>()(
  devtools(
    immer((set) => ({
      ...initialState,

      // 书籍操作
      setCurrentBook: (book) => set((state) => { state.currentBook = book; }),
      setCurrentBookId: (bookId) => set((state) => { state.currentBookId = bookId; }),

      // 内容操作
      setCurrentContent: (content) => set((state) => { state.currentContent = content; }),
      setCurrentChapter: (chapter) => set((state) => { state.currentChapter = chapter; }),
      setToc: (toc) => set((state) => { state.toc = toc; }),

      // 位置操作
      setCurrentPage: (page) => set((state) => { state.currentPage = page; }),
      setTotalPages: (pages) => set((state) => { state.totalPages = pages; }),
      setProgress: (progress) => set((state) => { state.progress = progress; }),
      setCurrentPosition: (position) => set((state) => { state.currentPosition = position; }),
      setTotalLength: (length) => set((state) => { state.totalLength = length; }),
      goToPage: (page) => set((state) => { state.currentPage = Math.max(1, Math.min(page, state.totalPages)); }),
      goToNextPage: () => set((state) => { if (state.currentPage < state.totalPages) state.currentPage++; }),
      goToPrevPage: () => set((state) => { if (state.currentPage > 1) state.currentPage--; }),
      goToPosition: (position) => set((state) => { state.currentPosition = Math.max(0, Math.min(position, state.totalLength)); }),

      // 设置操作
      setFontSize: (size) => set((state) => { state.fontSize = Math.max(12, Math.min(32, size)); }),
      increaseFontSize: () => set((state) => { state.fontSize = Math.min(32, state.fontSize + 2); }),
      decreaseFontSize: () => set((state) => { state.fontSize = Math.max(12, state.fontSize - 2); }),
      setLineHeight: (height) => set((state) => { state.lineHeight = height; }),
      setPageMargins: (margins) => set((state) => { state.pageMargins = margins; }),
      setFontFamily: (family) => set((state) => { state.fontFamily = family; }),

      // 视图操作
      toggleFullscreen: () => set((state) => { state.isFullscreen = !state.isFullscreen; }),
      toggleToolbar: () => set((state) => { state.isToolbarVisible = !state.isToolbarVisible; }),
      toggleSidebar: () => set((state) => { state.isSidebarOpen = !state.isSidebarOpen; }),
      setToolbarVisible: (visible) => set((state) => { state.isToolbarVisible = visible; }),
      setSidebarOpen: (open) => set((state) => { state.isSidebarOpen = open; }),
      toggleProgressBar: () => set((state) => { state.showProgressBar = !state.showProgressBar; }),

      // 搜索操作
      setSearchQuery: (query) => set((state) => { state.searchQuery = query; }),
      setSearchResults: (results) => set((state) => { state.searchResults = results; }),
      setCurrentSearchIndex: (index) => set((state) => { state.currentSearchIndex = index; }),
      goToNextSearchResult: () => set((state) => { if (state.currentSearchIndex < state.searchResults.length - 1) state.currentSearchIndex++; }),
      goToPrevSearchResult: () => set((state) => { if (state.currentSearchIndex > 0) state.currentSearchIndex--; }),
      clearSearch: () => set((state) => { state.searchQuery = ''; state.searchResults = []; state.currentSearchIndex = 0; }),
      setIsSearching: (isSearching) => set((state) => { state.isSearching = isSearching; }),

      // 批注操作
      setSelectedText: (text) => set((state) => { state.selectedText = text; }),
      setSelectionPosition: (position) => set((state) => { state.selectionPosition = position; }),
      clearSelection: () => set((state) => { state.selectedText = ''; state.selectionPosition = null; }),
      toggleAnnotationMode: () => set((state) => { state.isAnnotationMode = !state.isAnnotationMode; }),
      toggleAnnotationPanel: () => set((state) => { state.showAnnotationPanel = !state.showAnnotationPanel; }),
      setAnnotationPanelOpen: (open) => set((state) => { state.showAnnotationPanel = open; }),

      // 状态操作
      setIsLoading: (loading) => set((state) => { state.isLoading = loading; }),
      setIsRendering: (rendering) => set((state) => { state.isRendering = rendering; }),
      setError: (error) => set((state) => { state.error = error; }),
      clearError: () => set((state) => { state.error = null; }),
      reset: () => set((state) => { Object.assign(state, initialState); }),
    })),
    { name: 'ReaderStore' }
  )
);
