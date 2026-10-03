/**
 * Behavioral suite for the `/api/*` proxy Worker, parameterized on the Worker
 * under test.
 *
 * These assertions are load-bearing, not cosmetic:
 *   - the gate key must never reach the harness
 *   - the upstream host must never be reachable from a client-chosen path
 *   - the response body must stream through untouched, or SSE dies
 * Stating them here rather than inline keeps them a contract the Worker is held
 * to, rather than a description of what it currently happens to do.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Env {
  ASSETS: Fetcher;
  FELIX_ORIGIN: string;
  CHAT_UI_KEY?: string;
  FELIX_API_KEY?: string;
}

/**
 * The shape of the Worker's default export (`satisfies ExportedHandler<Env>`):
 * same `Env`, and `ctx` optional so the suite can call `fetch` without one. The
 * Worker must assign to this with no cast — that assignment is the only
 * type-level link between this suite and the code it holds to the contract.
 */
export interface ProxyWorker {
  fetch(req: Request, env: Env, ctx?: ExecutionContext): Promise<Response>;
}

const ORIGIN = 'https://harness.example.com';

export function describeProxyWorker(label: string, worker: ProxyWorker): void {
  let upstream: ReturnType<typeof vi.fn>;
  let assets: ReturnType<typeof vi.fn>;

  const env = (over: Partial<Env> = {}): Env => ({
    ASSETS: { fetch: assets } as unknown as Fetcher,
    FELIX_ORIGIN: ORIGIN,
    ...over,
  });

  /**
   * What the harness answers the Worker's own `GET /auth/methods`. Unset is a
   * 404 — an older harness — which must read as "does not verify bearers".
   */
  let methods: Response | (() => Response) | null;

  /**
   * A call the Worker made on its own behalf, to ask whether the harness verifies
   * bearers, rather than one it proxied. Proxied requests are the only ones sent
   * with `redirect: 'manual'`.
   */
  const isMethodsProbe = (call: unknown[]): boolean =>
    (call[1] as RequestInit | undefined)?.redirect !== 'manual';

  const proxiedCalls = () => upstream.mock.calls.filter((c) => !isMethodsProbe(c));
  const probeCalls = () => upstream.mock.calls.filter(isMethodsProbe);

  /** The Request the Worker handed to the upstream fetch. */
  const upstreamCall = (): Request => {
    const calls = proxiedCalls();
    expect(calls).toHaveLength(1);
    const [input, init] = calls[0] as [string, RequestInit];
    return new Request(input, init as RequestInit);
  };

  beforeEach(() => {
    methods = null;
    upstream = vi.fn(async (_input: string, init?: RequestInit) => {
      if (init?.redirect !== 'manual') {
        if (methods === null) return new Response('not found', { status: 404 });
        return typeof methods === 'function' ? methods() : methods.clone();
      }
      return new Response('upstream ok', { status: 200 });
    });
    assets = vi.fn(async () => new Response('<!doctype html>', { status: 200 }));
    vi.stubGlobal('fetch', upstream);
  });

  describe(`${label} proxy Worker`, () => {
    describe('routing', () => {
      it('serves non-/api paths from ASSETS without touching the harness', async () => {
        const res = await worker.fetch(new Request('https://app.example.com/threads/42'), env());
        expect(await res.text()).toBe('<!doctype html>');
        expect(assets).toHaveBeenCalledTimes(1);
        expect(upstream).not.toHaveBeenCalled();
      });

      it('strips the /api prefix and preserves the query string', async () => {
        await worker.fetch(new Request(`https://app.example.com/api/audit?limit=5&x=y`), env());
        expect(upstreamCall().url).toBe(`${ORIGIN}/audit?limit=5&x=y`);
      });

      it('does not double the slash when FELIX_ORIGIN has a trailing one', async () => {
        await worker.fetch(
          new Request('https://app.example.com/api/v1/models'),
          env({ FELIX_ORIGIN: `${ORIGIN}/` }),
        );
        expect(upstreamCall().url).toBe(`${ORIGIN}/v1/models`);
      });

      it('answers 502 rather than guessing when FELIX_ORIGIN is unset', async () => {
        const res = await worker.fetch(
          new Request('https://app.example.com/api/v1/models'),
          env({ FELIX_ORIGIN: '' }),
        );
        expect(res.status).toBe(502);
        expect(await res.json()).toMatchObject({ error: 'felix_origin_unset' });
        expect(upstream).not.toHaveBeenCalled();
      });
    });

    // A client controls the path. It must never be able to point the Worker's
    // credentialed request at a host of its choosing.
    describe('upstream targeting', () => {
      const hostile = [
        '/api/../secret',
        '/api/..%2fsecret',
        '/api//evil.example.net/steal',
        '/api/%2e%2e%2f%2e%2e%2fsecret',
        '/api/@evil.example.net/x',
        '/api/https://evil.example.net/x',
      ];

      for (const path of hostile) {
        it(`keeps the upstream host for ${path}`, async () => {
          const res = await worker.fetch(new Request(`https://app.example.com${path}`), env());
          if (upstream.mock.calls.length > 0) {
            expect(new URL(upstreamCall().url).host).toBe(new URL(ORIGIN).host);
          } else {
            // Normalized away from /api/ by URL parsing, so it fell through to
            // the SPA — also fine, and notably not a request to another host.
            expect(res.status).toBe(200);
            expect(assets).toHaveBeenCalled();
          }
        });
      }
    });

    describe('the shared-key gate', () => {
      const gated = env({ CHAT_UI_KEY: 'correct-horse' });

      it('rejects a missing key', async () => {
        const res = await worker.fetch(new Request('https://app.example.com/api/audit'), gated);
        expect(res.status).toBe(401);
        // `gate` is how the page tells the Worker's refusal from the harness's:
        // only this one is answered by a key.
        expect(await res.json()).toMatchObject({ error: 'unauthorized', gate: 'chat_key' });
        expect(upstream).not.toHaveBeenCalled();
      });

      it('rejects a wrong key of the same length', async () => {
        const res = await worker.fetch(
          new Request('https://app.example.com/api/audit', {
            headers: { 'x-chat-key': 'correct-hors3' },
          }),
          gated,
        );
        expect(res.status).toBe(401);
        expect(upstream).not.toHaveBeenCalled();
      });

      it('rejects a key of a different length', async () => {
        const res = await worker.fetch(
          new Request('https://app.example.com/api/audit', { headers: { 'x-chat-key': 'short' } }),
          gated,
        );
        expect(res.status).toBe(401);
        expect(upstream).not.toHaveBeenCalled();
      });

      it('accepts the correct key', async () => {
        const res = await worker.fetch(
          new Request('https://app.example.com/api/audit', {
            headers: { 'x-chat-key': 'correct-horse' },
          }),
          gated,
        );
        expect(res.status).toBe(200);
        expect(upstream).toHaveBeenCalledTimes(1);
      });

      it('gates every method, not just GET', async () => {
        for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
          upstream.mockClear();
          const res = await worker.fetch(
            new Request('https://app.example.com/api/chat/stream', { method, body: '{}' }),
            gated,
          );
          expect(res.status, `${method} should be gated`).toBe(401);
          expect(upstream).not.toHaveBeenCalled();
        }
      });

      it('lets requests through when no key is configured', async () => {
        await worker.fetch(new Request('https://app.example.com/api/audit'), env());
        expect(upstream).toHaveBeenCalledTimes(1);
      });

      it('never forwards the gate key upstream', async () => {
        await worker.fetch(
          new Request('https://app.example.com/api/audit', {
            headers: { 'x-chat-key': 'correct-horse' },
          }),
          gated,
        );
        expect(upstreamCall().headers.get('x-chat-key')).toBeNull();
      });
    });

    // The harness's GitHub login: the routes that hand out a bearer, and the
    // bearer standing in for the shared key afterwards. The second is the one
    // that can open a hole — under FELIX_AUTH_MODE=none the harness accepts any
    // bearer, so the Worker may honour one only when the harness says it checks.
    describe('cross-site writes', () => {
      const post = (headers: Record<string, string>) =>
        new Request('https://app.example.com/api/skill-library/x/versions/1.0.0/publish', {
          method: 'POST',
          headers,
        });

      it('refuses a write the browser marks cross-site, before reaching the harness', async () => {
        const res = await worker.fetch(post({ 'sec-fetch-site': 'cross-site' }), env());
        expect(res.status).toBe(403);
        expect(upstream).not.toHaveBeenCalled();
      });

      it('refuses a write from a foreign Origin, even with the key and a bearer', async () => {
        const res = await worker.fetch(
          post({
            origin: 'https://evil.example',
            'x-chat-key': 'k',
            authorization: 'Bearer t',
          }),
          env({ CHAT_UI_KEY: 'k', FELIX_API_KEY: 'deploy' }),
        );
        expect(res.status).toBe(403);
        expect(upstream).not.toHaveBeenCalled();
      });

      it('refuses the login routes cross-site too', async () => {
        const res = await worker.fetch(
          new Request('https://app.example.com/api/auth/github/device', {
            method: 'POST',
            headers: { origin: 'null' },
          }),
          env(),
        );
        expect(res.status).toBe(403);
      });

      it('lets a same-origin write through, and every read whatever its origin', async () => {
        const same = await worker.fetch(
          post({ origin: 'https://app.example.com', 'sec-fetch-site': 'same-origin' }),
          env({ FELIX_API_KEY: 'deploy' }),
        );
        expect(same.status).toBe(200);
        const read = await worker.fetch(
          new Request('https://app.example.com/api/audit', {
            headers: { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' },
          }),
          env(),
        );
        expect(read.status).toBe(200);
      });

      it('holds a headerless write (not a browser) to the key gate, as before', async () => {
        expect((await worker.fetch(post({}), env({ CHAT_UI_KEY: 'k' }))).status).toBe(401);
        expect(
          (await worker.fetch(post({ 'x-chat-key': 'k' }), env({ CHAT_UI_KEY: 'k' }))).status,
        ).toBe(200);
        expect((await worker.fetch(post({}), env())).status).toBe(200);
      });
    });

    describe('caller credentials', () => {
      const gated = env({ CHAT_UI_KEY: 'correct-horse', FELIX_API_KEY: 'sk-upstream' });
      const verifies = (value: boolean) => () =>
        Response.json({ github_device: true, bearer_required: value });
      // The Worker caches the harness's answer per origin, for the life of the
      // isolate. A fresh origin per test keeps one test's answer out of the next.
      let n = 0;
      const fresh = () => {
        n += 1;
        const origin = `https://h${n}.example.com`;
        return { origin, env: { ...gated, FELIX_ORIGIN: origin } as Env };
      };

      for (const [method, path] of [
        ['GET', '/auth/methods'],
        ['POST', '/auth/github/device'],
        ['POST', '/auth/github/token'],
      ] as const) {
        it(`lets ${method} ${path} through without the key, and with no credential of ours`, async () => {
          const res = await worker.fetch(
            new Request(`https://app.example.com/api${path}`, {
              method,
              headers: { authorization: 'Bearer stale' },
              body: method === 'POST' ? '{}' : undefined,
            }),
            gated,
          );
          expect(res.status).toBe(200);
          const sent = upstreamCall();
          expect(sent.url).toBe(`${ORIGIN}${path}`);
          expect(sent.headers.get('authorization')).toBeNull();
        });
      }

      it('keeps the other /auth routes behind the key', async () => {
        for (const [method, path] of [
          ['POST', '/auth/methods'],
          ['GET', '/auth/github/token'],
          ['POST', '/auth/github/actions'],
          ['POST', '/auth/github/device/x'],
        ]) {
          upstream.mockClear();
          const res = await worker.fetch(
            new Request(`https://app.example.com/api${path}`, {
              method,
              body: method === 'POST' ? '{}' : undefined,
            }),
            gated,
          );
          expect(res.status, `${method} ${path}`).toBe(401);
          expect(proxiedCalls()).toHaveLength(0);
        }
      });

      it('forwards a bearer in place of the key when the harness verifies bearers', async () => {
        const { origin, env: e } = fresh();
        methods = verifies(true);
        const res = await worker.fetch(
          new Request('https://app.example.com/api/audit', {
            headers: { authorization: 'Bearer felix-jwt' },
          }),
          e,
        );
        expect(res.status).toBe(200);
        const sent = upstreamCall();
        expect(sent.url).toBe(`${origin}/audit`);
        // The caller's own token, not the deployment's.
        expect(sent.headers.get('authorization')).toBe('Bearer felix-jwt');
      });

      it('refuses a bearer when the harness does not verify bearers', async () => {
        const { env: e } = fresh();
        methods = verifies(false);
        const res = await worker.fetch(
          new Request('https://app.example.com/api/audit', {
            headers: { authorization: 'Bearer anything' },
          }),
          e,
        );
        expect(res.status).toBe(401);
        expect(proxiedCalls()).toHaveLength(0);
      });

      it('fails closed when the harness cannot say', async () => {
        for (const answer of [
          () => new Response('not found', { status: 404 }),
          () => new Response('<html>', { status: 200 }),
          () => {
            throw new TypeError('network');
          },
        ]) {
          const { env: e } = fresh();
          methods = answer;
          upstream.mockClear();
          const res = await worker.fetch(
            new Request('https://app.example.com/api/audit', {
              headers: { authorization: 'Bearer anything' },
            }),
            e,
          );
          expect(res.status).toBe(401);
          expect(proxiedCalls()).toHaveLength(0);
        }
      });

      it('asks the harness once, not on every request', async () => {
        const { env: e } = fresh();
        methods = verifies(true);
        for (let i = 0; i < 3; i++) {
          await worker.fetch(
            new Request('https://app.example.com/api/audit', {
              headers: { authorization: 'Bearer felix-jwt' },
            }),
            e,
          );
        }
        expect(probeCalls()).toHaveLength(1);
        expect(proxiedCalls()).toHaveLength(3);
      });

      it('does not ask at all for a request carrying the key', async () => {
        const { env: e } = fresh();
        methods = verifies(true);
        await worker.fetch(
          new Request('https://app.example.com/api/audit', {
            headers: { 'x-chat-key': 'correct-horse', authorization: 'Bearer felix-jwt' },
          }),
          e,
        );
        expect(probeCalls()).toHaveLength(0);
        // The key path is unchanged: the deployment's credential, not the caller's.
        expect(upstreamCall().headers.get('authorization')).toBe('Bearer sk-upstream');
      });
    });

    describe('headers', () => {
      it('strips client-supplied cf-* and host headers', async () => {
        await worker.fetch(
          new Request('https://app.example.com/api/audit', {
            headers: {
              'cf-connecting-ip': '10.0.0.1',
              'cf-ray': 'abc',
              'cf-ipcountry': 'XX',
              'cf-visitor': '{"scheme":"https"}',
            },
          }),
          env(),
        );
        const sent = upstreamCall().headers;
        for (const h of ['cf-connecting-ip', 'cf-ray', 'cf-ipcountry', 'cf-visitor']) {
          expect(sent.get(h), `${h} should not be forwarded`).toBeNull();
        }
      });

      it('injects the upstream bearer token when configured', async () => {
        await worker.fetch(
          new Request('https://app.example.com/api/audit'),
          env({ FELIX_API_KEY: 'sk-upstream' }),
        );
        expect(upstreamCall().headers.get('authorization')).toBe('Bearer sk-upstream');
      });

      it('overrides a client-supplied Authorization with the configured token', async () => {
        await worker.fetch(
          new Request('https://app.example.com/api/audit', {
            headers: { authorization: 'Bearer attacker-chosen' },
          }),
          env({ FELIX_API_KEY: 'sk-upstream' }),
        );
        expect(upstreamCall().headers.get('authorization')).toBe('Bearer sk-upstream');
      });

      it('keeps content-type and other ordinary headers', async () => {
        await worker.fetch(
          new Request('https://app.example.com/api/chat/stream', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: '{}',
          }),
          env(),
        );
        expect(upstreamCall().headers.get('content-type')).toBe('application/json');
      });
    });

    describe('bodies and responses', () => {
      it('forwards a POST body', async () => {
        await worker.fetch(
          new Request('https://app.example.com/api/chat/stream', {
            method: 'POST',
            body: '{"manifest":"cowork"}',
          }),
          env(),
        );
        expect(await upstreamCall().text()).toBe('{"manifest":"cowork"}');
      });

      it('sends no body for GET', async () => {
        await worker.fetch(new Request('https://app.example.com/api/audit'), env());
        const [, init] = upstream.mock.calls[0] as [string, RequestInit];
        expect(init.body).toBeUndefined();
      });

      it('passes the upstream response through, headers included', async () => {
        upstream.mockResolvedValueOnce(
          new Response('data: {"event":"x"}\n\n', {
            status: 200,
            headers: { 'content-type': 'text/event-stream', 'x-manifest-variant': 'canary' },
          }),
        );
        const res = await worker.fetch(
          new Request('https://app.example.com/api/chat/stream', { method: 'POST', body: '{}' }),
          env(),
        );
        expect(res.headers.get('x-manifest-variant')).toBe('canary');
        expect(res.headers.get('content-type')).toBe('text/event-stream');
        expect(await res.text()).toBe('data: {"event":"x"}\n\n');
      });

      it('propagates an upstream error status instead of masking it', async () => {
        upstream.mockResolvedValueOnce(new Response('nope', { status: 503 }));
        const res = await worker.fetch(new Request('https://app.example.com/api/audit'), env());
        expect(res.status).toBe(503);
      });
    });
  });
}
