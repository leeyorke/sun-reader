/**
 * useSystemFonts - 枚举系统已安装字体
 *
 * 首选主进程枚举（Windows 读注册表 / Linux fc-list / macOS 字体目录，经 IPC
 * 返回已去重的 family 名列表）；Electron 渲染层多数情况下不暴露 Chromium 的
 * navigator.queryLocalFonts（其依赖浏览器端本地字体权限实现），仅作次选兜底。
 * enabled 为 true 时才发起读取，避免应用启动时的额外开销。
 */

import * as React from 'react';

interface SystemFontsState {
  fonts: string[];
  loading: boolean;
  error: string | null;
}

export function useSystemFonts(enabled: boolean): SystemFontsState {
  const [state, setState] = React.useState<SystemFontsState>({
    fonts: [],
    loading: false,
    error: null,
  });
  const requestedRef = React.useRef(false);

  React.useEffect(() => {
    if (!enabled || requestedRef.current) return;
    requestedRef.current = true;
    setState((s) => ({ ...s, loading: true }));

    (async () => {
      // 1) 主进程枚举（首选）
      if (window.electronAPI?.system?.listFonts) {
        try {
          const res = await window.electronAPI.system.listFonts();
          if (res.success && res.fonts.length) {
            setState({ fonts: res.fonts, loading: false, error: null });
            return;
          }
        } catch {
          /* 落入兜底 */
        }
      }

      // 2) 兜底：Chromium Local Font Access API（部分环境可用）
      try {
        if (navigator.queryLocalFonts) {
          const data = await navigator.queryLocalFonts();
          const families = Array.from(new Set(data.map((f) => f.family))).sort((a, b) =>
            a.localeCompare(b)
          );
          if (families.length) {
            setState({ fonts: families, loading: false, error: null });
            return;
          }
        }
      } catch {
        /* 落入错误态 */
      }

      setState({ fonts: [], loading: false, error: '无法读取系统字体' });
    })();
  }, [enabled]);

  return state;
}
