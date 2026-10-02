/*
 * The app shell's service worker. Hand-written and small on purpose: it does
 * exactly two things, and everything it does not do is a decision.
 *
 * It DOES:
 *   - answer a page load from the network, and from the last copy of the page
 *     only when the network fails. An installed app opened on a train then
 *     shows the gate's own "offline" screen instead of the browser's error
 *     page, and a deploy is live on the next load, never one load late.
 *   - keep the hashed build files (`/assets/*`) it has fetched, which never
 *     change under one name, so that offline page has scripts to run.
 *
 * It does NOT touch `/api/*`. That is the live console: SSE streams, uploads,
 * `x-chat-key`, approvals that must be current or not shown at all. A cached
 * approval list is worse than none. Those requests are never intercepted, so a
 * new version of this file can take over at once (`skipWaiting`) without any
 * risk to a run in flight — there is nothing of a run's here to disturb.
 *
 * `VERSION` names the caches. Change it when this file's caching changes; old
 * caches are deleted on activation. A new deploy of the app does not need it:
 * pages are network-first and asset names are content hashes.
 */

const VERSION = 'v1';
const SHELL = `felix-shell-${VERSION}`;
const ASSETS = `felix-assets-${VERSION}`;
/** Deploys add new hashed files under new names; keep the newest this many. */
const MAX_ASSETS = 120;

self.addEventListener('install', (event) => {
  // Take the current page and the files it names now, so the very first
  // offline launch after install already has a shell to show.
  event.waitUntil(precacheShell().catch(() => {}));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = new Set([SHELL, ASSETS]);
      for (const name of await caches.keys()) {
        if (name.startsWith('felix-') && !keep.has(name)) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(page(request));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(asset(request));
  }
});

/** Network first; the last good copy of the shell when the network fails. */
async function page(request) {
  try {
    const res = await fetch(request);
    // Every route is the same SPA document, so one copy serves all of them.
    if (res.ok) {
      const copy = res.clone();
      caches.open(SHELL).then((c) => c.put('/', copy));
    }
    return res;
  } catch (err) {
    const cached = await caches.match('/', { cacheName: SHELL, ignoreVary: true });
    if (cached) return cached;
    throw err;
  }
}

/**
 * Cache first: a hashed name is never a different file.
 *
 * `ignoreVary` because a module script is requested with an `Origin` header and
 * a precached copy was stored without one, so a server that answers with
 * `Vary: Origin` made every cached script a miss — measured: offline, the shell
 * loaded and its bundle did not, leaving a blank page. A hashed file's bytes do
 * not vary by anything.
 */
async function asset(request) {
  const cached = await caches.match(request, { cacheName: ASSETS, ignoreVary: true });
  if (cached) return cached;
  const res = await fetch(request);
  if (res.ok) {
    const copy = res.clone();
    caches.open(ASSETS).then(async (c) => {
      await c.put(request, copy);
      await trim(c);
    });
  }
  return res;
}

async function trim(cache) {
  const keys = await cache.keys();
  // `keys()` is in insertion order, so the oldest go first.
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_ASSETS))) await cache.delete(key);
}

async function precacheShell() {
  const res = await fetch('/', { cache: 'no-cache' });
  if (!res.ok) return;
  const html = await res.clone().text();
  await (await caches.open(SHELL)).put('/', res);
  const urls = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  if (urls.length) await (await caches.open(ASSETS)).addAll(urls);
}
