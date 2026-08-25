# Security Policy

## Reporting a vulnerability

Please report security issues privately via [GitHub Security Advisories](https://github.com/felix-run/web/security/advisories/new) ("Report a vulnerability"). Do **not** open a public issue for anything exploitable.

You can expect an acknowledgement within a few days. Please include reproduction steps, the affected surface (route, package, or component), and impact.

## Scope

This repository is the **web frontends** for Felix — a chat UI and a docs site, both Cloudflare Workers. It holds no database, no tenant data and no agent runtime; the harness those clients talk to is a separate self-hosted Python service at [felix-run/felix](https://github.com/felix-run/felix), which has [its own security policy](https://github.com/felix-run/felix/blob/main/SECURITY.md). Report harness-side issues — auth modes, governance wrappers, tenant isolation in Postgres, SSRF from harness tools — there, not here.

In scope for this repo:

- **The proxy Worker** (`apps/chat-ui/worker/index.ts`) — anything that leaks `FELIX_API_KEY` into a response or log, forwards the browser's `x-chat-key` upstream, lets a client-supplied `Authorization` header through, or makes the upstream URL attacker-influenced (path traversal, an absolute URL, encoded slashes, CRLF).
- **The shared-key gate** (`src/lib/auth.ts`, `components/gate.tsx`) — bypassing `CHAT_UI_KEY` on any method or `/api/*` path shape, or a non-constant-time comparison. Note the gate is an access gate, not user authentication: it grants whatever the harness grants the Worker's credential.
- **Browser-executed client tools and the VFS** (`packages/cowork-client`) — escaping the virtual filesystem root or a File System Access mount via `..`, absolute paths, backslashes, percent-encoded traversal or unicode lookalikes; writing outside the mounted directory; a destructive operation reaching disk without an approval; or an approval banner that misrepresents the arguments it is approving.
- **Rendering untrusted content** (`components/chat/*`) — script execution or markup injection from model output, tool results, or a streamed partial frame; unsafe link schemes; a `data:text/html` riding an image path.
- **Secret placement** — a credential in `wrangler.jsonc` `vars`, a `VITE_`-prefixed variable, `index.html`, `dist/`, or `localStorage` beyond the gate key and UI state.

## Supported versions

Pre-1.0; only the latest state of `main` is supported. Fixes land on `main` and ship in the next tagged release.
