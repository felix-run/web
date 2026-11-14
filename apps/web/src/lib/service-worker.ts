/**
 * Register `public/sw.js`, the app shell's service worker, in a built app.
 *
 * Not under `vite dev`: a worker answering page loads from a cache is the last
 * thing wanted while files change on every save. What it caches and what it
 * refuses to touch (all of `/api/*`) is documented in the file itself.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  // After load, so the worker's own fetches do not compete with the first paint.
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // An app without its offline shell is still the whole app.
    });
  });
}
