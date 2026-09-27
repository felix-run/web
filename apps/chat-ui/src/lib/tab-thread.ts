/**
 * The thread this tab was last on, for the addresses that name none.
 *
 * The address is the thread: `/t/:threadSuffix` chooses it, and `/` mints one.
 * Every *other* address keeps the thread the tab was already on — but after a
 * reload on `/harness` the tab has no "already", so the shell minted a fresh id
 * and the header's Chat link led to an empty thread instead of the one the
 * operator left.
 *
 * `sessionStorage`, not `localStorage`, and that difference is the design. The
 * old `felix.threadId` key was shared by every tab and read on every load, so it
 * *chose* the thread — which is how a fresh `/` inherited yesterday's transcript
 * (`tests/routing.test.tsx`). This is scoped to one tab, survives only that
 * tab's reloads, and is read only where the address names no thread and is not
 * `/`. It remembers; it never chooses over an address.
 */
const KEY = 'felix.tabThread';

export function rememberTabThread(threadId: string): void {
  try {
    sessionStorage.setItem(KEY, threadId);
  } catch {
    // Storage disabled: the cost is a fresh thread after a reload on /harness.
  }
}

export function recallTabThread(): string | null {
  try {
    return sessionStorage.getItem(KEY)?.trim() || null;
  } catch {
    return null;
  }
}
