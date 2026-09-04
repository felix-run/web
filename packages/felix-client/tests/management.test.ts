import { describe, expect, it } from 'vitest';
import { createFelixClient } from '../src/transport';

/**
 * The management surface, driven the way a terminal client drives it.
 *
 * These routes lived in `apps/chat-ui/src/api.ts` until they moved here, and
 * every test they had went through `baseUrl: '/api'` with a shared key. That is
 * exactly the half of the arrangement a second client does *not* have: it points
 * at a real origin and sends a bearer token. So what is asserted below is the
 * thing chat-ui's suite structurally could not — that the path built is
 * harness-relative, and that nothing in here assumes the proxy prefix.
 */

/** A fetch double that records what was asked for and answers with `body`. */
function stub(body: unknown, init: { status?: number } = {}) {
  const calls: Array<{ url: string; method: string }> = [];
  const fetch = (async (input: string | URL | Request, opts: RequestInit = {}) => {
    calls.push({ url: String(input), method: opts.method ?? 'GET' });
    return new Response(JSON.stringify(body), {
      status: init.status ?? 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;
  return { calls, fetch };
}

const client = (fetch: typeof globalThis.fetch) =>
  createFelixClient({
    baseUrl: 'http://localhost:8080',
    headers: () => ({ authorization: 'Bearer k' }),
    fetch,
  });

describe('the management surface against a real origin', () => {
  it('builds harness-relative paths, with no /api prefix anywhere', async () => {
    const s = stub({ events: [], items: [], plans: [], tools: [], window_since: 0 });
    const c = client(s.fetch);

    await c.listAudit({ limit: 5 });
    await c.listUsage({ limit: 5 });
    await c.listPlans(3);
    await c.getToolMetrics();
    await c.listMemories();

    expect(s.calls.every((call) => !call.url.includes('/api/'))).toBe(true);
    expect(s.calls.map((call) => call.url)).toEqual([
      'http://localhost:8080/audit?limit=5',
      'http://localhost:8080/usage?limit=5',
      'http://localhost:8080/plans?limit=3',
      'http://localhost:8080/audit/metrics?limit=200',
      'http://localhost:8080/memory?limit=50',
    ]);
  });

  it('carries the caller credentials the same way the chat verbs do', async () => {
    const seen: Array<Record<string, string>> = [];
    const fetch = (async (_i: string | URL | Request, opts: RequestInit = {}) => {
      seen.push(opts.headers as Record<string, string>);
      return new Response('{"events":[]}', { headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof globalThis.fetch;

    await client(fetch).listAudit();
    expect(seen[0]?.authorization).toBe('Bearer k');
  });

  it('renames payload_json, which is the whole reason listAudit exists', async () => {
    // The harness serialises the payload as `payload_json` and the route aliases
    // only the envelope. Read `payload` off the raw row and it is `undefined` on
    // every event the harness has ever written — silently, because the type said
    // the field was there.
    const s = stub({ events: [{ id: 'a', payload_json: { tool: 'read_file' } }] });
    const [row] = await client(s.fetch).listAudit();
    expect(row?.payload).toEqual({ tool: 'read_file' });
  });

  it('flattens the opaque plan blob so steps is always an array', async () => {
    const s = stub({ plans: [{ id: 'p1', plan: { title: 'Ship it' } }] });
    const [plan] = await client(s.fetch).listPlans();
    expect(plan?.title).toBe('Ship it');
    // Declared flat, `p.steps` was undefined and the panel threw on `.filter`.
    expect(plan?.steps).toEqual([]);
  });

  it('throws a message describeError can read a status out of', async () => {
    const s = stub({}, { status: 403 });
    // `describeError` matches /:\s*(\d{3})\b/, so the spelling is load-bearing:
    // a 403 here means a key without `memory:read`, not an empty store.
    await expect(client(s.fetch).listMemories()).rejects.toThrow(/memory: 403/);
  });
});
