import React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
  details?: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    let message = error.message || 'An unexpected error occurred.';
    let details: string | undefined;
    try {
      const parsed = JSON.parse(error.message);
      if (parsed && parsed.operationType) {
        message = `Database permission or sync error during ${parsed.operationType} on ${parsed.path || 'record'}.`;
        details = parsed.error;
      }
    } catch {
      // plain error message
    }
    return { hasError: true, message, details };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('ErrorBoundary caught error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-8">
            <div className="flex items-center gap-3 text-red-700 mb-4">
              <AlertTriangle className="w-6 h-6 shrink-0" />
              <h1 className="text-lg font-bold font-display text-slate-900">Something interrupted this view</h1>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed mb-3">{this.state.message}</p>
            {this.state.details && (
              <p className="text-xs font-mono text-slate-500 bg-slate-50 border border-slate-200 rounded-lg p-3 mb-6 break-words">
                {this.state.details}
              </p>
            )}
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => this.setState({ hasError: false, message: '', details: undefined })}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0B1528] rounded-lg hover:bg-slate-800 transition-colors"
              >
                <RefreshCw className="w-4 h-4" />
                Try Again
              </button>
              <button
                type="button"
                onClick={() => window.location.assign('/')}
                className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-50 transition-colors"
              >
                Return Home
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
