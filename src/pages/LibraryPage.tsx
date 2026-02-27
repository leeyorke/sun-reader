import React from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function LibraryPage() {
  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-3xl font-bold">书库</h1>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          导入书籍
        </Button>
      </div>

      {/* Empty State */}
      <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
        <div className="w-24 h-24 mb-6 rounded-full bg-muted flex items-center justify-center">
          <svg
            className="w-12 h-12"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"
            />
          </svg>
        </div>
        <h3 className="text-lg font-medium text-foreground mb-2">
          书库是空的
        </h3>
        <p className="text-sm max-w-sm text-center">
          点击上方的"导入书籍"按钮，开始添加您的电子书到书库中。
        </p>
      </div>
    </div>
  );
}
