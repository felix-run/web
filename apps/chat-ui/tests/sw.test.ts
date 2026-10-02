import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The service worker, run for real against stubbed worker globals.
 *
 * What matters most here is what it refuses: `/api/*` is the live console —
 * SSE streams, uploads, approvals that must be current or not shown — and a
 * worker that answered any of it from a cache, or held a stream, would be a
 * stale decision surface. So the first thing pinned is that it never calls
 * `respondWith` for one. Then the two things it does do: a page load falls back
 * to the cached shell only when the network fails, and a hashed asset is
 * served from the cache once it has been fetched.
 */

type Handler = (event: unknown) => void;

let handlers: Record<string, Handler>;
let stores: Map<string, Map<string, Response>>;
let network: (url: string) => Promise<Response>;

function stubCaches() {
  stores = new Map();
  const open = async (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name) as Map<string, Response>;
    const key = (r: { url: string } | string) =>
      new URL(typeof r === 'string' ? r : r.url, ORIGIN).href;
    return {
      put: async (r: { url: string } | string, res: Response) => void store.set(key(r), res),
      match: async (r: { url: string } | string) => store.get(key(r))?.clone(),
      keys: async () => [...store.keys()].map((u) => new Request(u)),
      delete: async (r: { url: string } | string) => store.delete(key(r)),
      addAll: async (urls: string[]) => {
        for (const u of urls) store.set(key(u), await network(key(u)));
      },
    };
  };
  return {
    open,
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (
      r: { url: string; headers?: Headers } | string,
      opts?: { cacheName?: string; ignoreVary?: boolean },
    ) => {
      const names = opts?.cacheName ? [opts.cacheName] : [...stores.keys()];
      for (const n of names) {
        const hit = await (await open(n)).match(r);
        // What a real cache does with `Vary: Origin` when the request carries an
        // Origin the stored one did not: no match.
        const varies =
          hit?.headers.get('vary') === 'Origin' &&
          typeof r !== 'string' &&
          r.headers?.has('origin');
        if (hit && (!varies || opts?.ignoreVary)) return hit;
      }
      return undefined;
    },
  };
}

const ORIGIN = 'https://chat.example';
const SW_PATH = '../public/sw.js';

/** A fetch event, recording whether the worker took it. */
function fetchEvent(
  path: string,
  init: { mode?: string; method?: string; headers?: Record<string, string> } = {},
) {
  let response: Promise<Response> | null = null;
  // The three fields the worker reads; `Request.mode` cannot be set on a real one.
  const request = {
    url: `${ORIGIN}${path}`,
    method: init.method ?? 'GET',
    mode: init.mode ?? 'cors',
    headers: new Headers(init.headers),
  };
  return {
    event: {
      request,
      respondWith: (r: Promise<Response>) => {
        response = r;
      },
    },
    taken: () => response,
  };
}

beforeEach(async () => {
  handlers = {};
  network = async (url) => new Response(`net:${new URL(url).pathname}`, { status: 200 });
  vi.stubGlobal('self', {
    location: new URL(ORIGIN),
    addEventListener: (type: string, h: Handler) => {
      handlers[type] = h;
    },
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  });
  vi.stubGlobal('caches', stubCaches());
  vi.stubGlobal('fetch', (input: { url: string } | string) =>
    network(typeof input === 'string' ? new URL(input, ORIGIN).href : input.url),
  );
  vi.resetModules();
  // Through a variable: `public/` is plain JS with no types, and a literal
  // specifier would have the type check demand some.
  await import(/* @vite-ignore */ SW_PATH);
});

afterEach(() => vi.unstubAllGlobals());

describe('the service worker', () => {
  it('never answers for /api, whatever the method or mode', () => {
    for (const [path, init] of [
      ['/api/chat/stream', { method: 'POST' }],
      ['/api/approvals', {}],
      ['/api/v1/models', { mode: 'navigate' }],
    ] as const) {
      const f = fetchEvent(path, init);
      handlers.fetch(f.event);
      expect(f.taken()).toBeNull();
    }
  });

  it('loads a page from the network, and from the cached shell only when that fails', async () => {
    const online = fetchEvent('/t/abc', { mode: 'navigate' });
    handlers.fetch(online.event);
    expect(await (await (online.taken() as Promise<Response>)).text()).toBe('net:/t/abc');

    // Let the copy land, then lose the network.
    await new Promise((r) => setTimeout(r, 0));
    network = async () => {
      throw new TypeError('offline');
    };
    const offline = fetchEvent('/harness', { mode: 'navigate' });
    handlers.fetch(offline.event);
    expect(await (await (offline.taken() as Promise<Response>)).text()).toBe('net:/t/abc');
  });

  it('serves a hashed asset from the cache once fetched', async () => {
    const first = fetchEvent('/assets/index-abc.js');
    handlers.fetch(first.event);
    expect(await (await (first.taken() as Promise<Response>)).text()).toBe(
      'net:/assets/index-abc.js',
    );
    await new Promise((r) => setTimeout(r, 0));

    network = async () => {
      throw new TypeError('offline');
    };
    const again = fetchEvent('/assets/index-abc.js');
    handlers.fetch(again.event);
    expect(await (await (again.taken() as Promise<Response>)).text()).toBe(
      'net:/assets/index-abc.js',
    );
  });

  it('leaves other same-origin files and other origins to the browser', () => {
    for (const path of ['/favicon.svg', '/site.webmanifest']) {
      const f = fetchEvent(path);
      handlers.fetch(f.event);
      expect(f.taken()).toBeNull();
    }
  });

  it('serves a precached module script offline, though the server says Vary: Origin', async () => {
    // Measured before this was handled: a module script is requested with an
    // Origin header, the precache stored it without one, and every cached script
    // missed — the offline shell loaded and stayed blank.
    network = async (url) =>
      new URL(url).pathname === '/'
        ? new Response('<script type="module" src="/assets/index-xyz.js"></script>')
        : new Response('bundle', { headers: { vary: 'Origin' } });
    let done: Promise<unknown> = Promise.resolve();
    handlers.install({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;

    network = async () => {
      throw new TypeError('offline');
    };
    const script = fetchEvent('/assets/index-xyz.js', { headers: { origin: ORIGIN } });
    handlers.fetch(script.event);
    expect(await (await (script.taken() as Promise<Response>)).text()).toBe('bundle');
  });

  it('precaches the shell and the files it names on install', async () => {
    network = async (url) =>
      new URL(url).pathname === '/'
        ? new Response('<script type="module" src="/assets/index-xyz.js"></script>')
        : new Response(`net:${new URL(url).pathname}`);
    let done: Promise<unknown> = Promise.resolve();
    handlers.install({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect([...(stores.get('felix-assets-v1')?.keys() ?? [])]).toEqual([
      `${ORIGIN}/assets/index-xyz.js`,
    ]);
    expect(stores.get('felix-shell-v1')?.has(`${ORIGIN}/`)).toBe(true);
  });
});
