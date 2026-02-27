import React from 'react';
import { NavLink } from 'react-router-dom';
import { BookOpen, Settings, Library } from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  path: string;
  label: string;
  icon: React.ReactNode;
}

const navItems: NavItem[] = [
  { path: '/', label: '书库', icon: <Library size={20} /> },
  { path: '/reader', label: '阅读', icon: <BookOpen size={20} /> },
];

export function Sidebar() {
  return (
    <aside className="w-64 h-full bg-card border-r border-border flex flex-col">
      {/* Brand */}
      <div className="p-6 flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-primary flex items-center justify-center">
          <svg width="20" height="20" viewBox="0 0 32 32" fill="none">
            <circle cx="16" cy="16" r="6" fill="white"/>
          </svg>
        </div>
        <span className="font-semibold text-lg">Sun Reader</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
                isActive
                  ? 'bg-primary/10 text-primary'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
              )
            }
          >
            {item.icon}
            {item.label}
          </NavLink>
        ))}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-border">
        <NavLink
          to="/settings"
          className={({ isActive }) =>
            cn(
              'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
              isActive
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            )
          }
        >
          <Settings size={20} />
          设置
        </NavLink>
      </div>
    </aside>
  );
}
