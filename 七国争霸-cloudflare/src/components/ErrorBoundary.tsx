import React, { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Error Boundary：捕获子组件渲染错误，显示错误信息而非白屏/蓝屏。
 */
export default class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render(): ReactNode {
    if (this.state.hasError && this.state.error) {
      return (
        <div className="min-h-screen bg-gradient-to-br from-primary to-secondary p-4 flex items-center justify-center">
          <div className="bg-secondary rounded-2xl p-8 border border-danger/30 max-w-lg w-full text-center shadow-2xl">
            <div className="text-5xl mb-4">⚠️</div>
            <h2 className="text-2xl font-bold text-danger mb-4">页面渲染出错</h2>
            <pre className="text-xs text-gray-400 bg-primary/50 rounded-lg p-4 overflow-auto max-h-48 text-left mb-4">
              {this.state.error.message}
              {'\n\n'}
              {this.state.error.stack}
            </pre>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
              className="px-6 py-2 bg-accent text-primary font-bold rounded-lg hover:bg-accent/90"
            >
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
