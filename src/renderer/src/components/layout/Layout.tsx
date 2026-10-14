import { Outlet } from 'react-router-dom';
import { Sidebar } from './Sidebar';
import { WindowControls } from './WindowControls';
import { hasCustomCaption, needsCustomWindowControls } from '@/api/electronApi';
import { cn } from '@/lib/utils';

export function Layout() {
  // 自定义标题栏（titleBarStyle:'hidden'）时原生标题栏没了，窗口只能靠顶部这条
  // 拖拽区移动；Linux 仍是原生边框，不渲染也不预留高度。
  const customCaption = hasCustomCaption();

  return (
    <div className="h-screen flex bg-background text-foreground">
      <Sidebar />
      <main className={cn('flex-1 overflow-auto', customCaption && 'pt-2')}>
        <Outlet />
      </main>
      {/* caption 高度 32px（Win10/Win11 的标题栏高度）。透明，露出页面背景色。
          z 值盖住阅读页（z-1000）但低于各弹窗（z-1200+）；右上角的窗口按钮
          （WindowControls，z-1150）压在这条上面，所以那一块仍能点。 */}
      {customCaption && (
        <div aria-hidden className="titlebar-drag fixed inset-x-0 top-0 z-[1100] h-8" />
      )}
      {/* Windows 上原生三键不会画（titleBarStyle:'hidden' 去掉了 WS_SYSMENU），自己画 */}
      {needsCustomWindowControls() && <WindowControls />}
    </div>
  );
}
