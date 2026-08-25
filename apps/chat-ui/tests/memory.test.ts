import { describe, expect, it, vi } from 'vitest';
import { forgetMemory, listMemories, memoriesAsOf, searchMemories } from '../src/api';
import { describeError } from '../src/lib/errors';

/**
 * The memory client.
 *
 * Two things here are easy to get wrong and silent when wrong. `GET /memory` and
 * `GET /memory/search` return *different shapes* — search has `score` and
 * `channels` and no timestamps — so treating one as a subset of the other loses
 * exactly the field that explains a result. And these routes are newer than the
 * rest of the surface and separately scoped, so "empty store", "harness too old"
 * and "key too narrow" all arrive as an absence of rows unless the status is
 * turned into a sentence.
 */

function stub(status: number, body: unknown) {
  const spy = vi.fn(
    async (_input: unknown, _init?: RequestInit) => new Response(JSON.stringify(body), { status }),
  );
  vi.stubGlobal('fetch', spy);
  return spy;
}

describe('memory client', () => {
  it('reads the list rows', async () => {
    stub(200, {
      items: [
        { id: 'm1', kind: 'fact', content: 'remembered', topic_key: 'prefs', importance: 0.8 },
      ],
    });
    const rows = await listMemories();
    expect(rows).toHaveLength(1);
    expect(rows[0]?.content).toBe('remembered');
  });

  it('returns an empty list rather than undefined when nothing is stored', async () => {
    stub(200, {});
    await expect(listMemories()).resolves.toEqual([]);
  });

  it('passes the manifest and kind filters through', async () => {
    const spy = stub(200, { items: [] });
    await listMemories({ manifestId: 'cowork', kind: 'fact', limit: 5 });
    const url = String(spy.mock.calls[0]?.[0]);
    expect(url).toContain('manifest_id=cowork');
    expect(url).toContain('kind=fact');
    expect(url).toContain('limit=5');
  });

  // `channels` is the whole reason search is exposed: it says which retriever
  // produced a hit, which is usually the answer to "why did it recall that".
  it('keeps score and channels off a search hit', async () => {
    stub(200, {
      items: [{ id: 'm1', content: 'hit', kind: 'fact', score: 0.42, channels: ['fts', 'vector'] }],
    });
    const hits = await searchMemories('anything');
    expect(hits[0]?.score).toBe(0.42);
    expect(hits[0]?.channels).toEqual(['fts', 'vector']);
  });

  it('sends the query as `q`', async () => {
    const spy = stub(200, { items: [] });
    await searchMemories('what does it know');
    expect(String(spy.mock.calls[0]?.[0])).toContain('q=what+does+it+know');
  });

  it('reads the as-of rows out of the turn_seq envelope', async () => {
    stub(200, { turn_seq: 12, items: [{ id: 'm1', kind: 'fact', content: 'was believed' }] });
    const rows = await memoriesAsOf(12);
    expect(rows).toHaveLength(1);
  });

  it('puts the turn sequence in the path, not a query param', async () => {
    const spy = stub(200, { turn_seq: 12, items: [] });
    await memoriesAsOf(12);
    expect(String(spy.mock.calls[0]?.[0])).toContain('/api/memory/as-of/12');
  });

  it('forgets by id with DELETE', async () => {
    const spy = stub(200, { id: 'm1', status: 'forgotten' });
    await forgetMemory('m1');
    expect(String(spy.mock.calls[0]?.[0])).toContain('/api/memory/m1');
    expect(spy.mock.calls[0]?.[1]?.method).toBe('DELETE');
  });

  it('throws with the status so the panel can explain it', async () => {
    stub(404, { detail: 'Not Found' });
    await expect(listMemories()).rejects.toThrow(/404/);
  });

  // The two failures a self-hosted, separately-scoped surface actually produces.
  // Both look like "no memories" to a panel that only counts rows.
  it('distinguishes an old harness from a narrow key', () => {
    const tooOld = describeError(new Error('memory: 404'), 'read stored memory');
    const tooNarrow = describeError(new Error('memory: 403'), 'read stored memory');

    expect(tooOld.message).toMatch(/older version/i);
    expect(tooNarrow.message).toMatch(/not allowed|scope/i);
    expect(tooOld.message).not.toBe(tooNarrow.message);
  });
});
