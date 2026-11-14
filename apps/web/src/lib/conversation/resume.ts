/**
 * "The page is back" — one signal for the three ways it comes back.
 *
 * A phone suspends a page the moment the operator switches apps: timers stop,
 * so the always-on approval poll stops with them, and a live stream's
 * connection can die without an error ever reaching its reader. Nothing in the
 * page runs until it is foregrounded, and then nothing knows it was away. This
 * is how it finds out:
 *
 * - `visibilitychange` to visible — the ordinary case, on any browser;
 * - `pageshow` with `persisted` — restored from the back/forward cache, where
 *   no `visibilitychange` is promised and every connection is gone;
 * - `online` — the network came back, which on a phone often *is* the return.
 *
 * They tend to arrive together, so they are coalesced into one call a beat
 * later, carrying how long the page was hidden (0 when it never was).
 */

const COALESCE_MS = 250;

let hiddenAt: number | null =
  typeof document !== 'undefined' && document.visibilityState === 'hidden' ? Date.now() : null;
let lastResumeAt = 0;

/** When the page last came back, or 0. Read to ask "did this just happen because we returned?". */
export function lastResume(): number {
  return lastResumeAt;
}

export function onResume(callback: (info: { hiddenForMs: number }) => void): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let hiddenForMs = 0;

  const fire = (hiddenFor: number) => {
    hiddenForMs = Math.max(hiddenForMs, hiddenFor);
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      lastResumeAt = Date.now();
      const info = { hiddenForMs };
      hiddenForMs = 0;
      callback(info);
    }, COALESCE_MS);
  };

  const onVisibility = () => {
    if (document.visibilityState === 'hidden') {
      hiddenAt = Date.now();
      return;
    }
    const since = hiddenAt;
    hiddenAt = null;
    fire(since === null ? 0 : Date.now() - since);
  };
  const onPageShow = (e: PageTransitionEvent) => {
    if (e.persisted) fire(hiddenAt === null ? 0 : Date.now() - hiddenAt);
  };
  const onOnline = () => fire(0);

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pageshow', onPageShow);
  window.addEventListener('online', onOnline);
  return () => {
    if (timer) clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pageshow', onPageShow);
    window.removeEventListener('online', onOnline);
  };
}
