/**
 * Proxy Worker for the Felix chat UI.
 *
 * Serves the SPA from ASSETS and proxies `/api/*` to the self-hosted Python
 * Felix harness (`FELIX_ORIGIN`), stripping the `/api` prefix. Same contract
 * as the Vite dev proxy.
 *
 * When `CHAT_UI_KEY` is set, browser clients must send `x-chat-key` (see Gate).
 * That header is stripped before the upstream Felix request.
 */

interface Env {
  ASSETS: Fetcher;
  /** Public origin of Python Felix, e.g. https://api.example.com */
  FELIX_ORIGIN: string;
  CHAT_UI_KEY?: string;
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
      if (env.CHAT_UI_KEY) {
        const provided = req.headers.get('x-chat-key') ?? '';
        if (!timingSafeEqual(provided, env.CHAT_UI_KEY)) {
          return Response.json({ error: 'unauthorized' }, { status: 401 });
        }
      }

      const origin = (env.FELIX_ORIGIN || '').replace(/\/$/, '');
      if (!origin) {
        return Response.json(
          { error: 'felix_origin_unset', hint: 'Set vars.FELIX_ORIGIN in wrangler.jsonc' },
          { status: 502 },
        );
      }

      const rest = url.pathname.slice('/api'.length);
      const target = `${origin}${rest}${url.search}`;

      const headers = new Headers(req.headers);
      headers.delete('x-chat-key');
      headers.delete('host');
      headers.delete('cf-connecting-ip');
      headers.delete('cf-ray');
      headers.delete('cf-visitor');
      headers.delete('cf-ipcountry');

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
