/**
 * 全局错误边界：防止单个页面渲染崩溃导致整窗白屏
 */

import * as React from 'react';

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] 渲染崩溃:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="h-full flex items-center justify-center p-8">
          <div className="max-w-md text-center space-y-4">
            <h2 className="text-xl font-bold text-destructive">页面出了点问题</h2>
            <p className="text-sm text-muted-foreground break-all">
              {this.state.error.message}
            </p>
            <div className="flex gap-2 justify-center">
              <button
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm hover:bg-primary/90"
                onClick={() => this.setState({ error: null })}
              >
                重试
              </button>
              <button
                className="px-4 py-2 rounded-md border border-input text-sm hover:bg-accent"
                onClick={() => (window.location.hash = '#/')}
              >
                返回书库
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
