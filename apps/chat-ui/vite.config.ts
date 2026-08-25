import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

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

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
        ...(felixApiKey ? { headers: { Authorization: `Bearer ${felixApiKey}` } } : {}),
      },
    },
  },
});
