import { describe, expect, it } from 'vitest';
import { createFelixClient } from '../src/transport';

/**
 * `GET /audit/export` streams every matching event as JSON lines. A failure after the first page
 * cannot change the status any more, so the harness ends the file with an `export_incomplete`
 * line instead — and a file that stopped part way looks whole to whoever holds it unless the
 * client reads that line.
 */

function ndjson(lines: string[], disposition = 'attachment; filename="audit-100-200.jsonl"') {
  const calls: string[] = [];
  const fetch = (async (input: string | URL | Request) => {
    calls.push(String(input));
    return new Response(lines.map((l) => `${l}\n`).join(''), {
      status: 200,
      headers: { 'content-type': 'application/x-ndjson', 'content-disposition': disposition },
    });
  }) as unknown as typeof globalThis.fetch;
  return {
    calls,
    client: createFelixClient({ baseUrl: 'http://localhost:8080', headers: () => ({}), fetch }),
  };
}

const row = (id: number) => JSON.stringify({ id, event_type: 'tool_call', status: 'ok' });

describe('exportAudit', () => {
  it('asks for the window and filters it was given, and keeps the harness’s filename', async () => {
    const { calls, client } = ndjson([row(2), row(1)]);
    const out = await client.exportAudit({ since: 100, until: 200, status: 'error' });
    expect(calls).toEqual(['http://localhost:8080/audit/export?since=100&until=200&status=error']);
    expect(out).toMatchObject({ filename: 'audit-100-200.jsonl', events: 2, complete: true });
    expect(out.text).toBe(`${row(2)}\n${row(1)}\n`);
  });

  it('says an export the harness could not finish is incomplete, and does not count the marker', async () => {
    const { client } = ndjson([
      row(3),
      JSON.stringify({ error: 'export_incomplete', detail: 'internal error' }),
    ]);
    const out = await client.exportAudit({ since: 1 });
    expect(out.complete).toBe(false);
    expect(out.events).toBe(1);
    // The file keeps the line, so it says so too.
    expect(out.text).toContain('export_incomplete');
  });

  it('reads a last line cut mid-object as a body that stopped', async () => {
    const { client } = ndjson([row(1), '{"id": 2, "event_ty']);
    expect((await client.exportAudit()).complete).toBe(false);
  });

  it('counts an empty window as a complete export of nothing', async () => {
    const { client } = ndjson([], '');
    expect(await client.exportAudit({ since: 1 })).toMatchObject({
      events: 0,
      complete: true,
      filename: 'audit.jsonl',
    });
  });
});
