/**
 * Presence signals for runs nobody is watching.
 *
 * The rest of chat-ui assumes an operator is present: state lands in the rails
 * and the transcript, and that is enough. A background run breaks that
 * assumption — it can block on an approval minutes after the tab lost focus, so
 * a signal that only exists on screen does not exist at all.
 *
 * Three channels, deliberately cheap:
 *   - `document.title`, which is always in the tab strip;
 *   - the favicon, whose main pad takes the state's hue (`@felix/design/mark`) — the
 *     one channel that still reads once a crowded strip has cut the title
 *     down to its icon;
 *   - an OS notification, only when the tab is hidden and permission was
 *     already granted from a real user gesture (`armNotifications`).
 *
 * Title and icon reflect state even while the tab is visible. The spec that
 * preceded this file restored a plain title on focus; always reflecting is
 * simpler, has no "stuck title" failure mode, and still helps the operator find
 * the right tab among many.
 */

import { markDataUrl } from '@felix/design/mark';

export type Presence = 'idle' | 'working' | 'blocked';

const BASE_TITLE = 'Felix';

const PREFIX: Record<Presence, string> = {
  idle: '',
  working: '(…) Working — ',
  // Not "Approve": an agent's question blocks a run the same way an approval does,
  // and a tab reading "Approve" over a question sent the operator looking for a
  // decision that did not exist. Matched in `apps/tui/src/attention.ts`.
  blocked: '(!) Waiting on you — ',
};

let current: Presence = 'idle';
/**
 * Where the tab is, when that is not the conversation: `Activity`, `Memory`.
 * Every `/harness` page read "Felix chat" in the tab strip and in history, so
 * eight open destinations were eight identical tabs. The run state still leads,
 * because it is the thing a glance at the tab strip is for.
 */
let place: string | null = null;

function title(): string {
  return `${PREFIX[current]}${place ? `${place} — ` : ''}${BASE_TITLE}`;
}

/**
 * Repaint the SVG icon `index.html` declares. Idle goes back to the static
 * file rather than an equivalent `data:` URL, so a tab at rest serves the same
 * cacheable icon a fresh load does. Safari draws neither a swapped nor an SVG
 * favicon, so there the static mark stays and the title carries the state.
 */
function paintIcon(): void {
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"][type="image/svg+xml"]');
  if (!link) return;
  link.href = current === 'idle' ? '/favicon.svg' : markDataUrl({ state: current });
}

function paint(): void {
  try {
    document.title = title();
    paintIcon();
  } catch {
    // Non-DOM environment; the notification channel is independent.
  }
}

/** Name the page the tab is on, or `null` for the conversation. Idempotent. */
export function setPresencePlace(next: string | null): void {
  if (next === place) return;
  place = next;
  paint();
}

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
  // Through the service worker when there is one: an installed app on iOS, and Android
  // Chrome, refuse `new Notification()` outright, and the worker's notification also
  // routes a tap to the app (`sw.js`). The same tag replaces the previous one either way.
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
  if (sw) {
    void sw
      .getRegistration()
      .then((reg) =>
        reg ? reg.showNotification(title, { body, tag: 'felix-run' }) : construct(title, body),
      )
      .catch(() => construct(title, body));
    return;
  }
  construct(title, body);
}

function construct(title: string, body: string): void {
  try {
    live?.close();
    live = new Notification(title, { body, tag: 'felix-run' });
  } catch {
    // Some embeddings refuse direct construction. The title channel still carries
    // the state, so this is not worth surfacing.
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
  paint();

  if (!hidden()) return;
  if (next === 'blocked') {
    notify('Waiting on you', 'A run is waiting on you.');
  } else if (next === 'idle' && previous !== 'idle') {
    notify('Run finished', 'Felix is done with the current goal.');
  }
}

/** Test seam: forget the cached state and dismiss any live notification. */
export function resetPresence(): void {
  current = 'idle';
  place = null;
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
  // And the one the worker showed, or it would outlive the state it described.
  const sw = typeof navigator !== 'undefined' ? navigator.serviceWorker : undefined;
  void sw
    ?.getRegistration()
    .then((reg) => reg?.getNotifications({ tag: 'felix-run' }))
    .then((shown) => {
      for (const n of shown ?? []) n.close();
    })
    .catch(() => {});
}
