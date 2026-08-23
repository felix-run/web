/**
 * Presence signals for runs nobody is watching.
 *
 * The rest of chat-ui assumes an operator is present: state lands in the rails
 * and the transcript, and that is enough. A background run breaks that
 * assumption — it can block on an approval minutes after the tab lost focus, so
 * a signal that only exists on screen does not exist at all.
 *
 * Two channels, deliberately cheap:
 *   - `document.title`, which is always in the tab strip;
 *   - an OS notification, only when the tab is hidden and permission was
 *     already granted from a real user gesture (`armNotifications`).
 *
 * The title reflects state even while the tab is visible. The spec that
 * preceded this file restored a plain title on focus; always reflecting is
 * simpler, has no "stuck title" failure mode, and still helps the operator find
 * the right tab among many.
 */

export type Presence = 'idle' | 'working' | 'blocked';

const BASE_TITLE = 'Felix';

const TITLES: Record<Presence, string> = {
  idle: BASE_TITLE,
  working: `(…) Working — ${BASE_TITLE}`,
  blocked: `(!) Approve — ${BASE_TITLE}`,
};

let current: Presence = 'idle';
let live: Notification | null = null;

function notificationsGranted(): boolean {
  try {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
  } catch {
    return false;
  }
}

function notify(title: string, body: string): void {
  if (!notificationsGranted()) return;
  try {
    live?.close();
    live = new Notification(title, { body, tag: 'felix-run' });
  } catch {
    // Some embeddings (and Android Chrome) refuse direct construction. The
    // title channel still carries the state, so this is not worth surfacing.
    live = null;
  }
}

function hidden(): boolean {
  try {
    return document.visibilityState === 'hidden';
  } catch {
    return false;
  }
}

/**
 * Ask for notification permission. Must be called from a user gesture — arm it
 * when the operator chooses a background run, never on load. Resolves to
 * whether notifications can now be shown.
 */
export async function armNotifications(): Promise<boolean> {
  try {
    if (typeof Notification === 'undefined') return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

/**
 * Record what the run is doing. Idempotent: repeated calls with the same state
 * do nothing, so this is safe to drive from an effect that re-runs on every
 * queue change.
 */
export function setPresence(next: Presence): void {
  if (next === current) return;
  const previous = current;
  current = next;

  try {
    document.title = TITLES[next];
  } catch {
    // Non-DOM environment; the notification channel is independent.
  }

  if (!hidden()) return;
  if (next === 'blocked') {
    notify('Approval needed', 'A run is waiting on your decision.');
  } else if (next === 'idle' && previous !== 'idle') {
    notify('Run finished', 'Felix is done with the current goal.');
  }
}

/** Test seam: forget the cached state and dismiss any live notification. */
export function resetPresence(): void {
  current = 'idle';
  try {
    live?.close();
  } catch {
    // ignore
  }
  live = null;
}

/**
 * Dismiss a notification once the operator is back. Wired to `visibilitychange`
 * by the caller so this module owns no listeners of its own.
 */
export function clearNotification(): void {
  try {
    live?.close();
  } catch {
    // ignore
  }
  live = null;
}
