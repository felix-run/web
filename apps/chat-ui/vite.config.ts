import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * Local-dev config. `vite dev` serves the SPA on :5173 and proxies every
 * `/api/*` call to the self-hosted Python Felix harness (`make up` → :8080),
 * stripping the `/api` prefix. Mirrors the production proxy Worker.
 */

/**
 * Secrets for `vite dev`, read from the same `.dev.vars` that `wrangler dev`
 * gives the proxy Worker — one convention rather than two. Gitignored; copy
 * `.dev.vars.example`. `process.env` wins, so a one-off run can override it.
 *
 * Only ever read here, in config, so nothing from this file reaches the bundle.
 */
function devVars(): Record<string, string> {
  try {
    const raw = readFileSync(fileURLToPath(new URL('./.dev.vars', import.meta.url)), 'utf8');
    const out: Record<string, string> = {};
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq === -1) continue;
      out[trimmed.slice(0, eq).trim()] = trimmed
        .slice(eq + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
    }
    return out;
  } catch {
    // No file. Correct whenever the harness runs with FELIX_AUTH_MODE=none.
    return {};
  }
}

function resolveApiKey(): string {
  const vars = devVars();
  const key =
    process.env.FELIX_API_KEY ||
    vars.FELIX_API_KEY ||
    // The harness spells its own copy `FELIX_AUTH_API_KEYS`, so that is the name
    // people carry across. Accept it rather than 401 on every call with nothing
    // said, but name the canonical spelling — `FELIX_API_KEY` is what the
    // production Worker's secret is called, and one name is the point.
    vars.FELIX_AUTH_API_KEYS ||
    '';
  if (!key) {
    console.warn(
      '[felix] No FELIX_API_KEY in apps/chat-ui/.dev.vars — /api/* calls will 401 ' +
        'unless the harness runs with FELIX_AUTH_MODE=none.',
    );
  } else if (!process.env.FELIX_API_KEY && !vars.FELIX_API_KEY) {
    console.warn('[felix] Using FELIX_AUTH_API_KEYS from .dev.vars; rename it to FELIX_API_KEY.');
  } else if (key.trimStart().startsWith('{')) {
    // The harness's value is a JSON object keyed by token; the bearer is the key.
    console.warn(
      '[felix] FELIX_API_KEY looks like JSON — use the token inside it, not the object.',
    );
  }
  return key;
}

const felixApiKey = resolveApiKey();

/** The harness routes a caller uses to obtain a credential — the Worker's `LOGIN_ROUTES`. */
const LOGIN_ROUTES = new Set([
  'GET /auth/methods',
  'POST /auth/github/device',
  'POST /auth/github/token',
  // Redirect sign-in: GitHub's return lands on the callback as a top-level GET, and the page
  // collects its token with a same-origin POST. The callback's 302 and its HttpOnly cookies pass
  // through untouched (`redirect: 'manual'`), so the sign-in cookies are this origin's.
  'GET /auth/github/authorize',
  'GET /auth/github/callback',
  'POST /auth/github/exchange',
]);

/**
 * The Worker's cross-site write refusal (`worker/index.ts`, `crossSiteWrite`),
 * mirrored for `vite dev`, which injects the dev key just as the Worker injects
 * `FELIX_API_KEY` — so a page on another site could otherwise post to the local
 * harness as you. Registered before Vite's own middleware, so it runs ahead of
 * the proxy. The app itself is same-origin and never sees it.
 */
function refuseCrossSiteWrites(): Plugin {
  return {
    name: 'felix-refuse-cross-site-writes',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/') || req.method === 'GET' || req.method === 'HEAD') {
          return next();
        }
        const site = req.headers['sec-fetch-site'];
        const origin = req.headers.origin;
        const self = `http://${req.headers.host ?? ''}`;
        if (site === 'cross-site' || (origin !== undefined && origin !== self)) {
          res.statusCode = 403;
          res.setHeader('content-type', 'application/json');
          res.end('{"error":"cross_site_request"}');
          return;
        }
        next();
      });
    },
  };
}

/**
 * Streamdown imports `rehype-katex` at the top of its bundle, which put all of
 * KaTeX in every first load. In a build that one import resolves to a no-op;
 * `src/lib/katex-plugin.ts` — the only importer let through — loads the real
 * plugin when a reply has math. Build-only: the dev server pre-bundles
 * streamdown with esbuild, which never asks this hook, and loading KaTeX eagerly
 * there costs nothing.
 */
function lazyKatex(): Plugin {
  const shim = fileURLToPath(new URL('./src/lib/rehype-katex-omitted.ts', import.meta.url));
  const loader = fileURLToPath(new URL('./src/lib/katex-plugin.ts', import.meta.url));
  return {
    name: 'felix:lazy-katex',
    enforce: 'pre',
    apply: 'build',
    resolveId(id, importer) {
      if (id === 'rehype-katex' && importer !== loader) return shim;
      return null;
    },
  };
}

export default defineConfig({
  plugins: [refuseCrossSiteWrites(), lazyKatex(), react(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8080',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
        // The harness defaults to FELIX_AUTH_MODE=api_key (`make up` generates a
        // key), and every /api/* call 401s without this. The production Worker
        // injects the same header from its own FELIX_API_KEY secret — see
        // worker/index.ts. The *other* half of the Worker's auth, the CHAT_UI_KEY
        // gate on `x-chat-key`, stays absent here on purpose: the Worker is not
        // in the loop under `vite dev`, so there is nothing to gate.
        //
        // The Worker's other two rules are mirrored here, minus the check that
        // the harness verifies bearers — with no gate, there is nothing for a
        // bearer to get past. A browser's own bearer (from GitHub login) goes
        // upstream in place of the dev key, and the login routes carry no
        // credential at all.
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            const path = (req.url ?? '').replace(/^\/api/, '').split('?')[0];
            if (LOGIN_ROUTES.has(`${req.method} ${path}`)) {
              proxyReq.removeHeader('authorization');
            } else if (felixApiKey && !/^bearer\s+\S/i.test(req.headers.authorization ?? '')) {
              proxyReq.setHeader('authorization', `Bearer ${felixApiKey}`);
            }
          });
        },
      },
    },
  },
});
