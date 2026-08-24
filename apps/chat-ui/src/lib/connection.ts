import { useSyncExternalStore } from 'react';

/**
 * Whether the harness is currently reachable.
 *
 * The composer has always had a disconnected state: a "Reconnecting to the
 * assistant" pill, a helper line, a guard that refuses to submit. None of it
 * could render, because `isConnected` was passed as a literal `true`. The
 * affordance existed and nothing ever set the flag.
 *
 * The signal that matters here is not `navigator.onLine`. This client talks to a
 * self-hosted harness that is usually a process on the same machine, so the
 * common failure is the browser being perfectly online while the harness is not
 * running. What actually answers the question is whether requests are getting
 * through, and every request already funnels through one place.
 *
 * So `apiFetch` reports each outcome here: a `TypeError` from `fetch` means the
 * request never reached anything, and any response at all, including a 500, means
 * the harness is there and talking. Going offline at the browser level flips it
 * immediately rather than waiting for the next request to fail.
 */

let reachable = true;
const listeners = new Set<() => void>();

function set(next: boolean): void {
  if (next === reachable) return;
  reachable = next;
  for (const l of listeners) l();
}

/**
 * Record the outcome of a request.
 *
 * @param ok `false` only for a transport failure. An HTTP error is a reply, and a
 *           reply means the harness is reachable.
 */
export function reportReachability(ok: boolean): void {
  set(ok);
}

export function isHarnessReachable(): boolean {
  return reachable;
}

/** Subscribe to changes. Exported so non-React callers and tests can use it too. */
export function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // The browser knows about its own connectivity sooner than the next failed
  // request would tell us, so take that hint when it arrives.
  const offline = () => set(false);
  const online = () => set(true);
  window.addEventListener('offline', offline);
  window.addEventListener('online', online);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('offline', offline);
    window.removeEventListener('online', online);
  };
}

/** Subscribe a component to harness reachability. */
export function useHarnessReachable(): boolean {
  return useSyncExternalStore(subscribe, isHarnessReachable, () => true);
}

/** Test seam. */
export function resetReachability(): void {
  reachable = true;
  listeners.clear();
}
