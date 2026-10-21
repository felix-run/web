/**
 * Web Push: let the harness wake this device when a run is waiting on a person.
 *
 * The in-page signals — the tab title, a notification from a hidden tab, the attention line —
 * all need a page that is running, and a phone suspends the page the moment its owner switches
 * apps. A push reaches the device through its platform's push service and `public/sw.js`,
 * whether or not a page is open.
 *
 * Three facts shape the API. A subscription needs the service worker, which registers only in
 * a production build, so under `vite dev` push is simply unsupported. Safari subscribes only
 * from an installed web app, so on iOS a tab is `needs-install` rather than `unsupported`.
 * And the browser must be asked from a click: the server key is fetched ahead of it, so the
 * click goes straight to the permission prompt and the subscription, with no network round
 * trip in between to cost the gesture.
 */

import { getPushPublicKey, subscribePush, unsubscribePush } from '@/api';
import { identityKey } from '@/lib/auth';
import { isIOS, isStandalone } from '@/lib/platform';

export type PushCapability = 'unsupported' | 'needs-install' | 'available';

export function pushCapability(): PushCapability {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return 'unsupported';
  const apis =
    'serviceWorker' in navigator && 'PushManager' in window && typeof Notification !== 'undefined';
  // Safari exposes push only to a web app on the Home Screen; in a tab the APIs are absent,
  // which is a step away rather than a dead end.
  if (isIOS() && !isStandalone()) return 'needs-install';
  return apis ? 'available' : 'unsupported';
}

/** The service worker's registration, without waiting for one that may never come (dev). */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/**
 * The server key, or `null` when this deployment does not push. Fetched before the person is
 * asked anything, both to keep the click free of network and to never offer a switch that
 * would only fail.
 */
export async function loadPushKey(): Promise<string | null> {
  try {
    return await getPushPublicKey();
  } catch {
    return null;
  }
}

export type EnableResult = 'on' | 'denied' | 'failed';

/** Ask, subscribe, register. Call from a click, with the key `loadPushKey` returned. */
export async function enablePush(publicKey: string): Promise<EnableResult> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return 'denied';
  try {
    const reg = await registration();
    if (!reg) return 'failed';
    let sub = await reg.pushManager.getSubscription();
    // A subscription made with another deployment's key cannot receive this one's pushes.
    if (sub && !sameKey(sub, publicKey)) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(publicKey),
    });
    await subscribePush(sub.toJSON());
    rememberPushOwner(identityKey());
    return 'on';
  } catch {
    return 'failed';
  }
}

/** Stop pushes to this device: the browser forgets the subscription, then the harness does. */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const { endpoint } = sub;
  await sub.unsubscribe();
  rememberPushOwner(null);
  // Best effort: a subscription the browser has dropped makes the push service answer 410 on
  // the next send, and the harness deletes the row then anyway.
  await unsubscribePush(endpoint).catch(() => {});
}

/**
 * On load: bring the harness and this device back into agreement.
 *
 * The harness can lose a row without the browser knowing — five failed sends in a row, a reset
 * store, a different deployment behind the same address — and a device that believes it is
 * subscribed would then wait on pushes that never come. Subscribing is idempotent, so
 * re-sending costs one request.
 *
 * Three cases are dropped instead of re-sent, on both sides. Permission withdrawn since. A
 * subscription made with a key the deployment no longer uses: the push service refuses every
 * push signed with the new key (Apple answers `VapidPkHashMismatch`), so re-registering it
 * would keep a dead row alive and keep the device from ever being offered Turn on again. And
 * one another identity made (below). Each time `push-changed` fires, so the offer can reappear
 * without a reload.
 */
export async function resyncPush(): Promise<void> {
  if (pushCapability() !== 'available') return;
  const sub = await currentSubscription().catch(() => null);
  if (!sub) return;
  if (Notification.permission !== 'granted') {
    await disablePush().catch(() => {});
    announce();
    return;
  }
  const key = await loadPushKey();
  if (!key) return; // the deployment does not push (or could not be asked): leave things be
  if (!sameKey(sub, key)) {
    await disablePush().catch(() => {});
    announce();
    return;
  }
  // A subscription another identity made — a session that lapsed, then someone else's sign-in —
  // is not re-registered under this one: the device would take both tenants' approvals. It is
  // dropped, and whoever is signed in now turns pushes on for themselves.
  const owner = pushOwner();
  const now = identityKey();
  if (owner !== null && owner !== now) {
    await disablePush().catch(() => {});
    announce();
    return;
  }
  // One made before owners were recorded is taken as this identity's, as the cache is.
  if (owner === null) rememberPushOwner(now);
  await subscribePush(sub.toJSON()).catch(() => {});
}

/** Whose sign-in turned pushes on in this browser: `auth.ts`'s `identityKey()` then. */
const PUSH_OWNER = 'felix.pushOwner';

function pushOwner(): string | null {
  try {
    return localStorage.getItem(PUSH_OWNER);
  } catch {
    return null;
  }
}

function rememberPushOwner(identity: string | null): void {
  try {
    if (identity === null) localStorage.removeItem(PUSH_OWNER);
    else localStorage.setItem(PUSH_OWNER, identity);
  } catch {
    // Not remembered: the next load re-registers, as before owners were kept.
  }
}

/** Fired on `window` when this device's subscription was dropped, so the offer can reappear. */
export const PUSH_CHANGED = 'felix:push-changed';

function announce(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(PUSH_CHANGED));
}

function sameKey(sub: PushSubscription, publicKey: string): boolean {
  const held = sub.options?.applicationServerKey;
  if (!held) return true; // not reported by every browser; trust the subscription
  const want = base64UrlToBytes(publicKey);
  const have = new Uint8Array(held);
  return have.length === want.length && have.every((b, i) => b === want[i]);
}

function base64UrlToBytes(value: string): Uint8Array<ArrayBuffer> {
  const padded =
    value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
