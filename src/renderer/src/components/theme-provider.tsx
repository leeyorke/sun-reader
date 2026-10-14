import React, { createContext, useContext, useEffect, useState } from 'react';

import type { ElectronAPI, Theme } from '@/lib/types';

type ThemeProviderProps = {
  children: React.ReactNode;
  defaultTheme?: Theme;
  storageKey?: string;
};

type ThemeProviderState = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const initialState: ThemeProviderState = {
  theme: 'light',
  setTheme: () => null,
};

const ThemeProviderContext = createContext<ThemeProviderState>(initialState);

export function ThemeProvider({
  children,
  defaultTheme = 'light',
  storageKey = 'vite-ui-theme',
  ...props
}: ThemeProviderProps) {
  // 仅支持浅色/深色；旧存储的 'sepia' 等非法值回退到默认主题
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem(storageKey) as Theme | null;
    return stored === 'light' || stored === 'dark' ? stored : defaultTheme;
  });

  useEffect(() => {
    const root = window.document.documentElement;

    root.classList.remove('light', 'dark');
    root.classList.add(theme);

    // 同步原生标题栏：最小化/最大化/关闭由 OS 绘制，不吃 CSS 主题，深色主题下
    // 必须让主进程切 nativeTheme，否则是深底深字。背景色直接取 body 的计算值，
    // 唯一来源就是 index.css 的 --background，不在这里重复一份硬编码。
    const api = window.electronAPI as ElectronAPI | undefined;
    api?.app?.setNativeTheme(theme, window.getComputedStyle(document.body).backgroundColor)
      .catch(() => {});
  }, [theme]);

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme);
      setTheme(theme);
    },
  };

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  );
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext);

  if (context === undefined)
    throw new Error('useTheme must be used within a ThemeProvider');

  return context;
};
