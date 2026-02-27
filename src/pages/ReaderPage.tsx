import React from 'react';
import { useParams } from 'react-router-dom';

export function ReaderPage() {
  const { bookId } = useParams<{ bookId: string }>();

  return (
    <div className="h-full flex items-center justify-center">
      <div className="text-center">
        <h2 className="text-2xl font-bold mb-4">阅读器</h2>
        <p className="text-muted-foreground">书籍 ID: {bookId}</p>
        <p className="text-sm text-muted-foreground mt-4">
          阅读器功能正在开发中...
        </p>
      </div>
    </div>
  );
}
