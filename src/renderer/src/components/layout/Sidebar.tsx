import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { BookOpen, Settings, Library } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from '@/components/ui/toast';
import { useBooks } from '@/hooks/useBooks';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { path: '/', label: '书库', icon: <Library size={20} /> },
];

const linkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
    isActive
      ? 'bg-primary/10 text-primary'
      : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
  );

export function Sidebar() {
  const navigate = useNavigate();
  const { data: books } = useBooks();

  /** 正在阅读：跳转最近阅读的书；没有则提示并回书库 */
  const continueReading = React.useCallback(() => {
    const reading = books
      ?.filter((b) => b.lastRead)
      .sort((a, b) => b.lastRead!.localeCompare(a.lastRead!))[0];
    if (reading) {
      navigate(`/reader/${reading.id}`);
    } else {
      toast({
        title: '还没有正在阅读的书籍',
        description: '先从书库挑一本开始吧',
      });
      navigate('/');
    }
  }, [books, navigate]);

  return (
    <aside className="w-64 h-full bg-card border-r border-border flex flex-col shrink-0">
      {/* Brand */}
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="6" fill="white" />
          </svg>
        </div>
        <span className="font-semibold text-lg">Sun Reader</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => (
          <NavLink key={item.path} to={item.path} end className={linkClass}>
            {item.icon}
            {item.label}
          </NavLink>
        ))}
        <button
          onClick={continueReading}
          className={cn(
            'w-full flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
            'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          )}
        >
          <BookOpen size={20} />
          正在阅读
        </button>
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-border">
        <NavLink to="/settings" className={linkClass}>
          <Settings size={20} />
          设置
        </NavLink>
      </div>
    </aside>
  );
}
