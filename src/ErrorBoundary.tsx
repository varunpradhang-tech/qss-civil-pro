import { Component, type ReactNode } from 'react';

interface State { error: Error | null; }

// Prevents a render error from blanking the whole app; shows a recoverable message instead.
export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };
  static getDerivedStateFromError(error: Error): State { return { error }; }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, fontFamily: 'Inter, system-ui, sans-serif' }}>
          <h2 style={{ color: '#e11d48' }}>Something went wrong</h2>
          <p style={{ color: '#475569' }}>{this.state.error.message}</p>
          <button onClick={() => this.setState({ error: null })}
            style={{ marginTop: 8, padding: '8px 14px', borderRadius: 6, border: '1px solid #e2e8f0', cursor: 'pointer' }}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
