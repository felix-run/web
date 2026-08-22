import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Toaster } from 'sonner';
import App from './App';
import { Gate } from './components/gate';
import './index.css';

const Root = import.meta.env.DEV ? (
  <App />
) : (
  <Gate>
    <App />
  </Gate>
);

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    {Root}
    <Toaster position="top-center" richColors closeButton />
  </StrictMode>,
);
