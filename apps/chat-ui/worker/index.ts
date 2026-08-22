/**
 * Proxy Worker for the Felix chat UI.
 *
 * Two responsibilities, both same-origin so the browser never makes a
 * cross-origin request (no CORS needed on Felix):
 *
 *   1. /api/*  → strip the `/api` prefix and forward to FELIX_ORIGIN
 *               (self-hosted Python harness). Streaming SSE is preserved.
 *   2. else    → serve the built SPA from the ASSETS binding.
 *
 * This mirrors the Vite dev proxy (see vite.config.ts) so the front-end code
 * is identical in dev and production.
 */

interface Env {
  ASSETS: Fetcher;
  /** Public origin of the Python Felix API, e.g. https://api.example.com */
  FELIX_ORIGIN: string;
  // Optional shared access key. When set (`wrangler secret put CHAT_UI_KEY`),
  // every /api/* request must carry a matching `x-chat-key` header. Unset →
  // the proxy is open (local/demo default).
  CHAT_UI_KEY?: string;
}

/** Length-safe constant-time string compare (avoids early-exit timing leaks). */
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
      return fetch(new Request(target, req));
    }

    return env.ASSETS.fetch(req);
  },
} satisfies ExportedHandler<Env>;
