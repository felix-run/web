import { TooltipProvider } from '@felix/ui/tooltip';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import App from './App';
import { AppErrorFallback, ErrorBoundary } from './components/error-boundary';
import { Gate } from './components/gate';
import { ThemeProvider } from './components/theme-provider';
import './index.css';

// In dev the Vite proxy reaches Felix directly (no proxy Worker / secret), so
// there's nothing to gate. In a built/deployed app, wrap App in the key gate.
const Root = import.meta.env.DEV ? (
  <App />
) : (
  <Gate>
    <App />
  </Gate>
);

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider delayDuration={300}>
        <ErrorBoundary label="app" fallback={(error) => <AppErrorFallback error={error} />}>
          {Root}
        </ErrorBoundary>
        <Toaster position="top-center" richColors closeButton />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
