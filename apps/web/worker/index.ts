/**
 * Proxy Worker for the Felix chat UI.
 *
 * Serves the SPA from ASSETS (index.html for any path that is not a file) and proxies `/api/*` to the self-hosted Python
 * Felix harness (`FELIX_ORIGIN`), stripping the `/api` prefix. Same contract
 * as the Vite dev proxy.
 *
 * **It holds no credential of its own.** A browser reaches the harness as the
 * person who signed in — the bearer from the harness's GitHub or Google login,
 * forwarded untouched — and the harness alone decides what that bearer may do.
 * A request with none arrives with none, so a harness that requires sign-in
 * refuses it and one running `FELIX_AUTH_MODE=none` is open by its own choice.
 * There used to be a shared access key (`CHAT_UI_KEY`) that, once matched, sent
 * the request upstream as the deployment (`FELIX_API_KEY`); every holder was one
 * principal, and it was the way past every per-person control. Both are gone,
 * and a Worker that still has those secrets set ignores them.
 *
 * **A write from another site's page is refused before reaching the harness.**
 * The redirect sign-ins leave cookies on this origin, and refusing the write
 * costs a same-origin page nothing. Any method but GET and HEAD is refused when
 * the browser says the request is `Sec-Fetch-Site: cross-site`, or sends an
 * `Origin` that is not this one. A request with neither header is not a
 * browser's, and goes through on whatever credential it carries.
 */

interface Env {
  ASSETS: Fetcher;
  /** Public origin of Python Felix, e.g. https://api.example.com */
  FELIX_ORIGIN: string;
}

/** A state-changing request a browser made on another site's behalf. */
function crossSiteWrite(req: Request, self: string): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return false;
  if (req.headers.get('sec-fetch-site') === 'cross-site') return true;
  const origin = req.headers.get('origin');
  return origin !== null && origin !== self;
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
      const target = `${origin}${rest}${url.search}`;

      const headers = new Headers(req.headers);
      headers.delete('host');
      headers.delete('cf-connecting-ip');
      headers.delete('cf-ray');
      headers.delete('cf-visitor');
      headers.delete('cf-ipcountry');

      return fetch(target, {
        method: req.method,
        headers,
        body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
        // A sign-in callback's 302 and the cookies it sets pass through to the page untouched.
        redirect: 'manual',
        // @ts-expect-error Workers duplex streaming
        duplex: 'half',
      });
    }

    // A file that exists is served before this Worker runs, so a hashed name that reaches it does
    // not exist: an old build's chunk, asked for by a tab opened before a deploy. The SPA fallback
    // answered it with index.html, and `_headers` cached that HTML under the chunk's name for a
    // year — the lazy import failed, and kept failing, in that browser and its service worker.
    if (url.pathname.startsWith('/assets/')) {
      return new Response('Not found', { status: 404, headers: { 'cache-control': 'no-store' } });
    }

    // Any other miss is a route of the SPA (`not_found_handling` is "none", so the platform serves
    // no fallback of its own): the document, keeping the request's validators for a 304.
    return env.ASSETS.fetch(new Request(new URL('/', url), { headers: req.headers }));
  },
} satisfies ExportedHandler<Env>;
