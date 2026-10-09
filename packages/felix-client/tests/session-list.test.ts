import { describe, expect, it, vi } from 'vitest';
import { createFelixClient } from '../src/transport';

/**
 * `GET /chat/sessions` pages (`felix-run/felix#559`): 100 rows unless asked,
 * with `next_cursor` naming where the next page starts. Every caller of
 * `listSessions` builds a whole thread index from it, so a single read would
 * drop a tenant's oldest threads without any error to show for it.
 */

type Page = { ids: string[]; next?: string | null };

function client(pages: Record<string, Page>) {
  const urls: URL[] = [];
  const fetch = vi.fn(async (input: unknown) => {
    const url = new URL(String(input));
    urls.push(url);
    const page = pages[url.searchParams.get('cursor') ?? ''] ?? { ids: [] };
    const rows = page.ids.map((id) => ({ id: `acme:${id}` }));
    return new Response(
      JSON.stringify({ sessions: rows, items: rows, next_cursor: page.next ?? null }),
    );
  });
  const felix = createFelixClient({
    baseUrl: 'http://felix.test',
    fetch: fetch as unknown as typeof globalThis.fetch,
  });
  return { felix, urls };
}

describe('listSessions', () => {
  it('follows next_cursor to the last page', async () => {
    const { felix, urls } = client({
      '': { ids: ['c', 'b'], next: '20:acme:b' },
      '20:acme:b': { ids: ['a'], next: null },
    });

    expect((await felix.listSessions()).map((s) => s.id)).toEqual(['c', 'b', 'a']);
    expect(urls.map((u) => u.searchParams.get('cursor'))).toEqual([null, '20:acme:b']);
    // The largest page the route takes, so a long index costs as few reads as it can.
    expect(urls.every((u) => u.searchParams.get('limit') === '500')).toBe(true);
  });

  it('reads an older harness, which sends no cursor, once', async () => {
    const { felix, urls } = client({ '': { ids: ['a', 'b'] } });

    expect((await felix.listSessions()).map((s) => s.id)).toEqual(['a', 'b']);
    expect(urls).toHaveLength(1);
  });

  it('stops on a cursor that repeats instead of reading forever', async () => {
    const { felix, urls } = client({
      '': { ids: ['a'], next: 'x' },
      x: { ids: ['b'], next: 'x' },
    });

    expect((await felix.listSessions()).map((s) => s.id)).toEqual(['a', 'b']);
    expect(urls).toHaveLength(2);
  });
});
