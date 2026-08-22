import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import './theme.css';
import App from './App.js';
import { ErrorBoundary } from './ErrorBoundary.js';
import { UIProvider } from './state/ui.js';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <UIProvider>
          <App />
        </UIProvider>
      </HashRouter>
    </ErrorBoundary>
  </StrictMode>,
);
