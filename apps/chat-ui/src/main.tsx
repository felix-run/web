import { TooltipProvider } from '@felix/ui/tooltip';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import App from './App';
import { AppErrorFallback, ErrorBoundary } from './components/error-boundary';
import { Gate } from './components/gate';
import { ThemeProvider } from './components/theme-provider';
import { Toaster } from './components/toaster';
import { registerServiceWorker } from './lib/service-worker';
import './index.css';

registerServiceWorker();

// In dev the Vite proxy reaches Felix directly (no proxy Worker / secret), so
// there's nothing to gate. In a built/deployed app, wrap App in the key gate.
const Root = import.meta.env.DEV ? (
  <App />
) : (
  <Gate>
    <App />
  </Gate>
);

/**
 * A data router with one splat route around the declarative table, rather than
 * `BrowserRouter`. Nothing here uses loaders or actions — `App.tsx` stays the
 * declarative route table it was — but `useBlocker`, which the skill editor's
 * unsaved-changes guard needs, exists only under a data router.
 */
const router = createBrowserRouter([{ path: '*', element: Root }]);

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider delayDuration={300}>
        <ErrorBoundary label="app" fallback={(error) => <AppErrorFallback error={error} />}>
          {/* The Worker already serves `not_found_handling: single-page-application`,
              so a deep link to `/t/:threadSuffix` reaches this bundle rather than a
              404 and no Worker change is needed for these routes. */}
          <RouterProvider router={router} />
        </ErrorBoundary>
        <Toaster />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
