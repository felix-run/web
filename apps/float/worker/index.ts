/**
 * Proxy Worker for the Felix float client.
 * Same /api/* contract as chat-ui: strip prefix, optional gate key, inject API key.
 */

interface Env {
  ASSETS: Fetcher;
  FELIX_ORIGIN: string;
  CHAT_UI_KEY?: string;
  FELIX_API_KEY?: string;
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
      if (env.FELIX_API_KEY) {
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
