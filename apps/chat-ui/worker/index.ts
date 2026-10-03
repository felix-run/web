/**
 * Proxy Worker for the Felix chat UI.
 *
 * Serves the SPA from ASSETS and proxies `/api/*` to the self-hosted Python
 * Felix harness (`FELIX_ORIGIN`), stripping the `/api` prefix. Same contract
 * as the Vite dev proxy.
 *
 * A browser reaches the harness one of two ways:
 *
 * - **The shared key.** When `CHAT_UI_KEY` is set, a request must carry it as
 *   `x-chat-key`. That header is stripped before the upstream request, and
 *   `FELIX_API_KEY` (when set) is injected as the upstream credential — every
 *   key holder is the same principal.
 * - **Its own bearer** — a token from the harness's GitHub login. It goes
 *   upstream untouched and in place of the shared key, but only while the
 *   harness says it verifies bearers (`GET /auth/methods` → `bearer_required`).
 *   Under `FELIX_AUTH_MODE=none` the harness accepts any bearer at all, so
 *   honouring one there would make `Authorization: Bearer x` a way past the only
 *   lock the deployment has.
 *
 * The three login routes are public on both sides: they are how a browser
 * *gets* a bearer, so they cannot require one, and no credential of ours is
 * attached to them.
 *
 * **A write from another site's page is refused before any of that.** This
 * Worker attaches `FELIX_API_KEY` itself, so without a `CHAT_UI_KEY` a plain
 * cross-site form post — no custom header, no preflight — would arrive at the
 * harness carrying the deployment's credential: publish a skill, decide an
 * approval, forget a memory. Any method but GET and HEAD is refused when the
 * browser says the request is `Sec-Fetch-Site: cross-site`, or sends an
 * `Origin` that is not this one. A request with neither header is not a
 * browser's, and is held to the same gate as before: the shared key when one
 * is set.
 */

interface Env {
  ASSETS: Fetcher;
  /** Public origin of Python Felix, e.g. https://api.example.com */
  FELIX_ORIGIN: string;
  /** Shared gate key for browser clients (`x-chat-key`). */
  CHAT_UI_KEY?: string;
  /** Upstream Felix API key injected as `Authorization: Bearer …` (api_key mode). */
  FELIX_API_KEY?: string;
}

/** `<method> <harness path>` for each route a caller uses to obtain a credential. */
const LOGIN_ROUTES = new Set([
  'GET /auth/methods',
  'POST /auth/github/device',
  'POST /auth/github/token',
]);

/**
 * How long one answer about the harness's auth is trusted. A failed or
 * unreadable answer is held far shorter: it fails closed, and a harness that was
 * restarting should not lock every signed-in browser out for a minute.
 */
const METHODS_TTL_MS = 60_000;
const METHODS_RETRY_MS = 5_000;

/** Per isolate, keyed by origin so a re-pointed `FELIX_ORIGIN` asks again. */
const bearerVerified = new Map<string, { until: number; value: boolean }>();

async function harnessVerifiesBearers(origin: string): Promise<boolean> {
  const now = Date.now();
  const cached = bearerVerified.get(origin);
  if (cached && cached.until > now) return cached.value;
  let value = false;
  let ttl = METHODS_RETRY_MS;
  try {
    const res = await fetch(`${origin}/auth/methods`, { headers: { accept: 'application/json' } });
    if (res.ok) {
      const body = (await res.json()) as { bearer_required?: unknown };
      value = body.bearer_required === true;
      ttl = METHODS_TTL_MS;
    }
  } catch {
    // Unreachable or not JSON: fail closed, and ask again soon.
  }
  bearerVerified.set(origin, { until: now + ttl, value });
  return value;
}

/** A state-changing request a browser made on another site's behalf. */
function crossSiteWrite(req: Request, self: string): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return false;
  if (req.headers.get('sec-fetch-site') === 'cross-site') return true;
  const origin = req.headers.get('origin');
  return origin !== null && origin !== self;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname.startsWith('/api/')) {
      const origin = (env.FELIX_ORIGIN || '').replace(/\/$/, '');
      if (!origin) {
        return Response.json(
          { error: 'felix_origin_unset', hint: 'Set vars.FELIX_ORIGIN in wrangler.jsonc' },
          { status: 502 },
        );
      }

      if (crossSiteWrite(req, url.origin)) {
        return Response.json({ error: 'cross_site_request' }, { status: 403 });
      }

      const rest = url.pathname.slice('/api'.length);
      const login = LOGIN_ROUTES.has(`${req.method} ${rest}`);

      // A browser's own bearer stands in for the shared key only when it is the
      // whole credential (no key alongside it) and the harness will check it.
      let asCaller = false;
      if (!login && !req.headers.has('x-chat-key')) {
        const bearer = /^bearer\s+\S/i.test(req.headers.get('authorization') ?? '');
        asCaller = bearer && (await harnessVerifiesBearers(origin));
      }

      if (!login && !asCaller && env.CHAT_UI_KEY) {
        const provided = req.headers.get('x-chat-key') ?? '';
        if (!timingSafeEqual(provided, env.CHAT_UI_KEY)) {
          // `gate` says the refusal is ours, not the harness's: the page offers
          // the key prompt only when there is a key that would open it.
          return Response.json({ error: 'unauthorized', gate: 'chat_key' }, { status: 401 });
        }
      }

      const target = `${origin}${rest}${url.search}`;

      const headers = new Headers(req.headers);
      headers.delete('x-chat-key');
      headers.delete('host');
      headers.delete('cf-connecting-ip');
      headers.delete('cf-ray');
      headers.delete('cf-visitor');
      headers.delete('cf-ipcountry');
      if (login) {
        headers.delete('authorization');
      } else if (!asCaller && env.FELIX_API_KEY) {
        headers.set('Authorization', `Bearer ${env.FELIX_API_KEY}`);
      }

      return fetch(target, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
        redirect: 'manual',
        // @ts-expect-error Workers duplex streaming
        duplex: 'half',
      });
    }

    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
