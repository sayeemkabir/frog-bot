import { Component, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@fontsource-variable/inter';
import './styles.css';

/** If a screen crashes, show what happened instead of a blank window. */
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error) {
    console.error('[frog-ui] crashed:', error.stack ?? error.message);
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="empty" style={{ height: '100%' }} data-testid="crash">
        <div>
          <h2>Something broke on this screen</h2>
          <p className="muted" style={{ maxWidth: 520, whiteSpace: 'pre-wrap' }}>{this.state.error.message}</p>
          <button className="btn primary" onClick={() => this.setState({ error: null })}>Try again</button>
        </div>
      </div>
    );
  }
}

window.addEventListener('error', (e) => console.error('[frog-ui] error:', e.message));
window.addEventListener('unhandledrejection', (e) => console.error('[frog-ui] unhandled:', String(e.reason?.message ?? e.reason)));

createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
