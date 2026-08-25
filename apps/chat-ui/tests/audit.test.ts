import { describe, expect, it, vi } from 'vitest';
import { listAudit } from '../src/api';

/**
 * The audit client, and specifically the one rename it exists to perform.
 *
 * `GET /audit` serialises the payload as `payload_json`. The route aliases the
 * *envelope* — it returns `items` and `events` side by side so either spelling of
 * the outer key works — which made the row shape look settled when it was not.
 * `AuditEvent` declared `payload`, `listAudit` cast the JSON straight to it, and
 * so every row arrived with `payload === undefined` while the type insisted
 * otherwise. Nothing threw: the Inspector's tool name silently fell back to the
 * manifest id and its summary line rendered as an empty string on every event the
 * harness has ever written.
 *
 * That is why these assertions are about a field name and not about behaviour.
 * A type assertion cannot catch this and neither can `check-api-drift`, which
 * compares paths and verbs and says nothing about payload shapes.
 */

function stub(status: number, body: unknown) {
  const spy = vi.fn(
    async (_input: unknown, _init?: RequestInit) => new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

const row = (over: Record<string, unknown> = {}) => ({
  id: 'a1',
  tenant_id: 'default',
  ts: 1787634970831,
  event_type: 'tool_call',
  manifest_id: 'quick',
  principal_subj: 'local-dev',
  status: 'ok',
  payload_json: { tool: 'read_file', tool_call_id: 'tc1' },
  ...over,
});

describe('audit client', () => {
  it('renames payload_json to payload', async () => {
    stub(200, { items: [row()], events: [row()], next_cursor: null });
    const rows = await listAudit();
    expect(rows[0]?.payload).toEqual({ tool: 'read_file', tool_call_id: 'tc1' });
  });

  it('never leaves payload undefined, because callers index into it unguarded', async () => {
    stub(200, { events: [row({ payload_json: undefined })] });
    const rows = await listAudit();
    expect(rows[0]?.payload).toEqual({});
  });

  it('accepts a row that already spells it payload, so a harness rename cannot blank the feed', async () => {
    stub(200, { events: [row({ payload_json: undefined, payload: { tool: 'shell' } })] });
    const rows = await listAudit();
    expect(rows[0]?.payload).toEqual({ tool: 'shell' });
  });

  it('carries the harness spelling of the principal through', async () => {
    stub(200, { events: [row()] });
    const rows = await listAudit();
    expect(rows[0]?.principal_subj).toBe('local-dev');
  });

  it('returns an empty list rather than undefined when nothing has been recorded', async () => {
    stub(200, {});
    await expect(listAudit()).resolves.toEqual([]);
  });

  it('sends the server-side filters the panel relies on', async () => {
    const spy = stub(200, { events: [] });
    await listAudit({ limit: 60, status: 'error', eventType: 'tool_call' });
    const url = String(spy.mock.calls[0]?.[0]);
    expect(url).toContain('limit=60');
    expect(url).toContain('status=error');
    expect(url).toContain('event_type=tool_call');
  });

  it('raises the status into an error rather than returning nothing', async () => {
    stub(403, {});
    await expect(listAudit()).rejects.toThrow('audit: 403');
  });
});
