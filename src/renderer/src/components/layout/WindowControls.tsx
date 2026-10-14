/**
 * WindowControls - 自定义窗口按钮（最小化 / 最大化还原 / 关闭）
 *
 * 为什么必须自己画：Windows 上 `titleBarStyle:'hidden'` 会把 `WS_SYSMENU` 一起去掉，
 * 没有系统菜单 Windows 就不画这三个键（实测窗口样式 0x14C70000，对比 'default' 的
 * 0x16CF0000）；`titleBarOverlay` 只对 Win11 有效，Win10 完全不认。所以 Win10 上想
 * 要「标题栏颜色跟主题一致」就必须连按钮一起自己画。
 * macOS 的红绿灯由系统保留、Linux 用原生边框，两边都不渲染这个组件。
 *
 * 位置：右上角、高 32px（= caption 高），盖在 Layout 的拖拽条之上但低于各弹窗，
 * 所以弹窗打开时它会被盖住 —— 那是故意的，弹窗期间不该能点窗口按钮。
 *
 * 整块必须加 `.titlebar-no-drag`：拖拽条是同一条 32px 带上的兄弟元素，不加
 * `no-drag` 的话 drag 区会把鼠标事件吞掉，按钮画得出来却点不动。
 */

import * as React from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';
import { electronApi } from '@/api/electronApi';
import { cn } from '@/lib/utils';

/** Windows 标题栏按钮：46x32，三个并排 */
const BTN = 'w-[46px] h-8 flex items-center justify-center transition-colors';

export function WindowControls() {
  const [maximized, setMaximized] = React.useState(false);

  // 主进程在 maximize/unmaximize 时推状态（拖拽到屏幕顶端、双击拖拽区也会触发），
  // 否则图标会停在错误的一档上
  React.useEffect(() => {
    const onState = (state: { maximized: boolean }) => setMaximized(!!state?.maximized);
    electronApi.on('window-state', onState);
    return () => electronApi.off('window-state', onState);
  }, []);

  const run = (action: 'minimize' | 'toggle-maximize' | 'close') => {
    electronApi.app
      .windowControl(action)
      .then((res) => {
        if (typeof res?.maximized === 'boolean') setMaximized(res.maximized);
      })
      .catch(() => {});
  };

  return (
    <div className="titlebar-no-drag fixed top-0 right-0 z-[1150] flex select-none text-foreground">
      <button
        type="button"
        aria-label="最小化"
        title="最小化"
        className={cn(BTN, 'hover:bg-foreground/10')}
        onClick={() => run('minimize')}
      >
        <Minus className="h-3 w-3" strokeWidth={1.25} />
      </button>
      <button
        type="button"
        aria-label={maximized ? '还原' : '最大化'}
        title={maximized ? '还原' : '最大化'}
        className={cn(BTN, 'hover:bg-foreground/10')}
        onClick={() => run('toggle-maximize')}
      >
        {maximized ? (
          <Copy className="h-3 w-3" strokeWidth={1.25} />
        ) : (
          <Square className="h-3 w-3" strokeWidth={1.25} />
        )}
      </button>
      {/* 关闭键的 hover 用 Windows 的红底白字，两个主题下都一致 */}
      <button
        type="button"
        aria-label="关闭"
        title="关闭"
        className={cn(BTN, 'hover:bg-[#e81123] hover:text-white')}
        onClick={() => run('close')}
      >
        <X className="h-3.5 w-3.5" strokeWidth={1.25} />
      </button>
    </div>
  );
}
