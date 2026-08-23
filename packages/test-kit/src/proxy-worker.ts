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

  /** The Request the Worker handed to the upstream fetch. */
  const upstreamCall = (): Request => {
    expect(upstream).toHaveBeenCalledTimes(1);
    const [input, init] = upstream.mock.calls[0] as [string, RequestInit];
    return new Request(input, init as RequestInit);
  };

  beforeEach(() => {
    upstream = vi.fn(async () => new Response('upstream ok', { status: 200 }));
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
        expect(await res.json()).toMatchObject({ error: 'unauthorized' });
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
