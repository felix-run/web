// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTO_FOLLOW_PAGES, LibraryList } from '../src/components/skills/library-list';
import { fakeHarness, mountWithProviders } from './skill-fixtures';

/**
 * The library list's paging. The route filters each page *after* reading it,
 * so a filtered page can come back empty with a `next_cursor` — and a list
 * that stopped there would say "nothing matches" over a library that has
 * matches three pages on. These pin that it follows the cursor, that it stops
 * following on its own after a bound, and that it never calls a page that had
 * more behind it the end.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const summary = (name: string) => ({
  name,
  live_version: null,
  latest: {
    version: '0.1.0',
    status: 'draft',
    source: 'agent',
    quality_score: 50,
    security_status: 'pass',
    created_at: Date.now(),
  },
  pending_drafts: 1,
  shadows_operator_upload: name === 'shadowed',
  created_by: 'quick',
  created_at: 1,
  updated_at: 2,
});

function cursorOf(path: string): string | null {
  return new URLSearchParams(path.split('?')[1] ?? '').get('cursor');
}

describe('LibraryList', () => {
  it('follows next_cursor past empty filtered pages to the rows behind them', async () => {
    const h = fakeHarness((req) => {
      if (!req.path.startsWith('/skill-library?')) return undefined;
      const pages: Record<string, { items: unknown[]; next_cursor: string | null }> = {
        '': { items: [], next_cursor: 'b' },
        b: { items: [], next_cursor: 'c' },
        c: { items: [summary('late-draft')], next_cursor: null },
      };
      return { body: pages[cursorOf(req.path) ?? ''] };
    });
    mountWithProviders(
      <LibraryList
        filter={{ status: 'draft' }}
        onFilter={() => {}}
        linkTo={(n) => `?skill=${n}`}
      />,
    );
    expect(await screen.findByRole('link', { name: 'late-draft' })).toBeTruthy();
    const listed = h.requests.filter((r) => r.path.startsWith('/skill-library?'));
    expect(listed.map((r) => cursorOf(r.path))).toEqual([null, 'b', 'c']);
    expect(listed.every((r) => r.path.includes('status=draft'))).toBe(true);
    expect(screen.queryByRole('button', { name: 'Load more' })).toBeNull();
  });

  it('stops walking on its own after a bound, and says there is more rather than none', async () => {
    let n = 0;
    const h = fakeHarness((req) =>
      req.path.startsWith('/skill-library?')
        ? { body: { items: [], next_cursor: `p${++n}` } }
        : undefined,
    );
    mountWithProviders(
      <LibraryList filter={{ source: 'operator' }} onFilter={() => {}} linkTo={(x) => x} />,
    );
    await screen.findByRole('button', { name: 'Load more' });
    await waitFor(() =>
      expect(h.requests.filter((r) => r.path.startsWith('/skill-library?'))).toHaveLength(
        1 + AUTO_FOLLOW_PAGES,
      ),
    );
    // Give a runaway loop the chance to show itself.
    await new Promise((r) => setTimeout(r, 50));
    expect(h.requests.filter((r) => r.path.startsWith('/skill-library?'))).toHaveLength(
      1 + AUTO_FOLLOW_PAGES,
    );
    expect(screen.getByRole('status').textContent).toMatch(/there are more to look through/);
  });

  it('loads the next page of an unfiltered list on request, appending to it', async () => {
    const h = fakeHarness((req) => {
      if (!req.path.startsWith('/skill-library?')) return undefined;
      return cursorOf(req.path) === 'm'
        ? { body: { items: [summary('second')], next_cursor: null } }
        : { body: { items: [summary('first'), summary('shadowed')], next_cursor: 'm' } };
    });
    mountWithProviders(<LibraryList filter={{}} onFilter={() => {}} linkTo={(x) => x} />);
    await screen.findByRole('link', { name: 'first' });
    // Unfiltered, a full page is not walked past without being asked.
    expect(h.requests.filter((r) => r.path.startsWith('/skill-library?'))).toHaveLength(1);
    expect(screen.getByText('shadows an upload')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    expect(await screen.findByRole('link', { name: 'second' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'first' })).toBeTruthy();
  });

  it('tells an empty library from a filter that matches nothing', async () => {
    fakeHarness((req) =>
      req.path.startsWith('/skill-library?')
        ? { body: { items: [], next_cursor: null } }
        : undefined,
    );
    const { unmount } = mountWithProviders(
      <LibraryList filter={{}} onFilter={() => {}} linkTo={(x) => x} />,
    );
    expect((await screen.findByRole('status')).textContent).toMatch(/The library is empty/);
    unmount();
    mountWithProviders(
      <LibraryList filter={{ status: 'archived' }} onFilter={() => {}} linkTo={(x) => x} />,
    );
    expect((await screen.findByRole('status')).textContent).toMatch(
      /No skill in the library matches/,
    );
  });
});
