/**
 * App Store - 应用全局状态
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

interface AppState {
  // 加载状态
  isLoading: boolean;
  isInitializing: boolean;

  // 错误状态
  error: string | null;

  // UI 状态
  sidebarOpen: boolean;
  activeModal: string | null;

  // 搜索状态
  searchQuery: string;
  isSearching: boolean;
}

interface AppActions {
  setLoading: (isLoading: boolean) => void;
  setInitializing: (isInitializing: boolean) => void;
  setError: (error: string | null) => void;
  clearError: () => void;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  openModal: (modalId: string) => void;
  closeModal: () => void;
  setSearchQuery: (query: string) => void;
  setSearching: (isSearching: boolean) => void;
}

const initialState: AppState = {
  isLoading: false,
  isInitializing: true,
  error: null,
  sidebarOpen: true,
  activeModal: null,
  searchQuery: '',
  isSearching: false,
};

export const useAppStore = create<AppState & AppActions>()(
  devtools(
    (set) => ({
      ...initialState,

      setLoading: (isLoading) => set({ isLoading }, false, 'setLoading'),
      setInitializing: (isInitializing) => set({ isInitializing }, false, 'setInitializing'),
      setError: (error) => set({ error }, false, 'setError'),
      clearError: () => set({ error: null }, false, 'clearError'),
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen }), false, 'toggleSidebar'),
      setSidebarOpen: (open) => set({ sidebarOpen: open }, false, 'setSidebarOpen'),
      openModal: (modalId) => set({ activeModal: modalId }, false, 'openModal'),
      closeModal: () => set({ activeModal: null }, false, 'closeModal'),
      setSearchQuery: (query) => set({ searchQuery: query }, false, 'setSearchQuery'),
      setSearching: (isSearching) => set({ isSearching }, false, 'setSearching'),
    }),
    { name: 'AppStore' }
  )
);
