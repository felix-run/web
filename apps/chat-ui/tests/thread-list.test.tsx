/** @vitest-environment happy-dom */

import { type ThreadMeta, UNTITLED_THREAD_TITLE } from '@felix/client';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThreadList } from '../src/components/chat/thread-list';

/**
 * The history rail's per-thread actions.
 *
 * Two things here are not obvious from reading the component. Rename is opened
 * from a Radix menu, and Radix returns focus to the trigger as that menu
 * unmounts — after the input has mounted — so a naive focus is silently undone
 * and the user types into nothing. And the three server-backed actions must stay
 * unavailable for a thread the harness has never seen, or they fail with a 400
 * the user cannot act on.
 */

vi.mock('../src/api', () => ({ searchSessions: vi.fn(async () => []) }));
const { searchSessions } = await import('../src/api');
const search = vi.mocked(searchSessions);

const thread = (over: Partial<ThreadMeta> = {}): ThreadMeta => ({
  id: 't1',
  title: 'Local title',
  manifest: 'cowork',
  updatedAt: Date.now(),
  onServer: true,
  ...over,
});

function setup(props: Partial<Parameters<typeof ThreadList>[0]> = {}) {
  const handlers = {
    onSelect: vi.fn(),
    onDelete: vi.fn(),
    onRename: vi.fn(),
    onFork: vi.fn(),
    onCompact: vi.fn(),
    onExport: vi.fn(),
  };
  render(<ThreadList threads={[thread()]} currentId="t1" {...handlers} {...props} />);
  return { ...handlers, user: userEvent.setup() };
}

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /^Actions for/ }));
};

beforeEach(() => {
  localStorage.clear();
  search.mockReset();
  search.mockResolvedValue([]);
});
afterEach(cleanup);

describe('ThreadList actions', () => {
  it('offers the per-thread actions, with Delete last', async () => {
    const { user } = setup();
    await openMenu(user);
    for (const label of ['Rename', 'Fork', 'Compact context', 'Export JSONL', 'Delete']) {
      expect(await screen.findByRole('menuitem', { name: label })).toBeTruthy();
    }
  });

  // The regression this file exists for.
  it('puts the caret in the rename field, not back on the menu trigger', async () => {
    const { user } = setup();
    await openMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));

    const field = await screen.findByLabelText('Thread name');
    await waitFor(() => {
      expect(document.activeElement).toBe(field);
    });
  });

  it('commits a rename on Enter', async () => {
    const { user, onRename } = setup();
    await openMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));

    const field = await screen.findByLabelText('Thread name');
    await waitFor(() => expect(document.activeElement).toBe(field));
    await user.keyboard('Quarterly review{Enter}');

    expect(onRename).toHaveBeenCalledWith('t1', 'Quarterly review');
  });

  it('abandons a rename on Escape', async () => {
    const { user, onRename } = setup();
    await openMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));

    const field = await screen.findByLabelText('Thread name');
    await waitFor(() => expect(document.activeElement).toBe(field));
    await user.keyboard('discard me{Escape}');

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Thread name')).toBeNull();
  });

  // Losing a typed name to a stray click is worse than an unintended rename,
  // which is undone by renaming again.
  it('commits rather than discards when the field loses focus', async () => {
    const { user, onRename } = setup();
    await openMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));

    const field = await screen.findByLabelText('Thread name');
    await waitFor(() => expect(document.activeElement).toBe(field));
    await user.keyboard('typed then clicked away');
    await user.click(screen.getByRole('searchbox', { name: 'Search threads' }));

    expect(onRename).toHaveBeenCalledWith('t1', 'typed then clicked away');
  });

  it('does not fire a rename for an empty name', async () => {
    const { user, onRename } = setup();
    await openMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));

    const field = await screen.findByLabelText('Thread name');
    await waitFor(() => expect(document.activeElement).toBe(field));
    await user.keyboard('   {Enter}');

    expect(onRename).not.toHaveBeenCalled();
  });

  it('disables the server-backed actions for a local-only thread', async () => {
    const { user } = setup({ threads: [thread({ onServer: false })] });
    await openMenu(user);

    for (const label of ['Fork', 'Compact context', 'Export JSONL']) {
      const item = await screen.findByRole('menuitem', { name: label });
      expect(item.getAttribute('aria-disabled')).toBe('true');
    }
    // A greyed item with no reason reads as broken.
    expect(screen.getByText(/harness has no record of this thread/)).toBeTruthy();
    // Rename is local-first — the harness accepts it for any thread it can create.
    expect(screen.getByRole('menuitem', { name: 'Rename' }).getAttribute('aria-disabled')).not.toBe(
      'true',
    );
  });

  it('marks a local-only thread in the row itself', () => {
    setup({ threads: [thread({ onServer: false })] });
    expect(screen.getByText(/local/)).toBeTruthy();
  });

  it('says nothing about the agent when none is known, rather than a placeholder', () => {
    setup({ threads: [thread({ manifest: '' })] });
    expect(screen.queryByText(/—/)).toBeNull();
    expect(screen.queryByText(/unknown/i)).toBeNull();
    expect(screen.getByText(/just now/)).toBeTruthy();
  });

  it('shows the agent as visible text, not only in a tooltip', () => {
    setup();
    expect(screen.getByText('cowork')).toBeTruthy();
  });
});

/**
 * Legible on return. A list whose every row read "Untitled conversation / — ·
 * 2d ago" gave someone coming back no way to tell which thread they were in.
 */
describe('ThreadList rows', () => {
  const untitled = (id: string) =>
    thread({ id, title: UNTITLED_THREAD_TITLE, manifest: '', named: false });

  it('falls back to the first user line cached for the thread', () => {
    localStorage.setItem(
      'felix.turns:t1',
      JSON.stringify([{ id: 'u', role: 'user', content: 'Draft the quarterly notes' }]),
    );
    setup({ threads: [untitled('t1')] });
    expect(screen.getByText('Draft the quarterly notes')).toBeTruthy();
    expect(screen.queryByText(UNTITLED_THREAD_TITLE)).toBeNull();
  });

  it("falls back to the harness's thread id, in mono, when nothing better exists", () => {
    setup({ threads: [untitled('self-readiness-1')], currentId: 'x' });
    const id = screen.getByText('self-readiness-1');
    expect(id.className).toContain('font-mono');
    expect(screen.queryByText(UNTITLED_THREAD_TITLE)).toBeNull();
  });

  it('keeps a name someone typed over any fallback', () => {
    setup({ threads: [thread({ title: 'Quarterly review', named: true })] });
    expect(screen.getByText('Quarterly review')).toBeTruthy();
  });

  it('marks a thread with a pending approval in words, not by colour alone', () => {
    setup({
      threads: [thread({ id: 't1' }), thread({ id: 't2', title: 'Other' })],
      blocked: new Set(['t2']),
    });
    const waiting = screen.getByRole('group', { name: /^Waiting on you/ });
    expect(waiting.textContent).toContain('Other');
    expect(waiting.textContent).not.toContain('Local title');
  });

  it('finds a row by what it shows, including a fallback title', async () => {
    localStorage.setItem(
      'felix.turns:t9',
      JSON.stringify([{ id: 'u', role: 'user', content: 'Migrate the billing table' }]),
    );
    const { user } = setup({ threads: [thread(), untitled('t9')] });
    await user.type(screen.getByRole('searchbox', { name: 'Search threads' }), 'billing');
    expect(screen.getByText('Migrate the billing table')).toBeTruthy();
    expect(screen.queryByText('Local title')).toBeNull();
  });
});

/**
 * What a returning operator reads to find a thread. An untitled thread is listed
 * by its id, and ids that differ differ at the end — so the row keeps both ends
 * rather than the head alone. And the list uses one noun for what it lists.
 */
describe('ThreadList rows', () => {
  const uuid = 'c9471ae6-345f-4288-a933-6f1e2d3c4b5a';

  it('cuts an untitled thread id from the middle, and keeps it whole to a reader', () => {
    setup({ threads: [thread({ id: uuid, title: UNTITLED_THREAD_TITLE })], currentId: 'x' });
    const row = screen.getByTitle(uuid);
    // What is drawn fits the row by itself rather than leaving CSS to cut the end
    // off — which drew `c9471ae6-345f-4288-a933-6…`, dropping the tail two UUIDs
    // differ in.
    const drawn = row.querySelector('[aria-hidden]')?.textContent ?? '';
    expect(drawn.length).toBeLessThanOrEqual(30);
    expect(drawn.startsWith('c9471ae6')).toBe(true);
    expect(drawn.endsWith('6f1e2d3c4b5a')).toBe(true);
    expect(screen.getByRole('button', { name: new RegExp(`^${uuid}`) })).toBeTruthy();
  });

  it('names the list, its search and its empty state for threads', () => {
    setup({ threads: [] });
    expect(screen.getByRole('heading', { name: 'Threads' })).toBeTruthy();
    expect(screen.getByRole('searchbox', { name: 'Search threads' })).toBeTruthy();
    expect(screen.getByText('No threads yet')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/History|sessions|conversation/);
  });
});

/**
 * A row's actions answer to *that row's* hover. The sidebar's root is an unnamed
 * `group`, so a bare `group-hover` on a row matched the pointer anywhere in the
 * sidebar and lit every row's actions at once. happy-dom applies no hover, so
 * what is pinned is the shape: the row's group is named, and the reveal reads it.
 * And the actions sit over the row rather than beside it, so an invisible pair
 * of buttons no longer takes a third of every title's width.
 */
describe('a row and its actions', () => {
  it('reveal on their own row only, laid over its end', () => {
    setup();
    const actions = screen
      .getAllByRole('button', { name: /^Actions for/ })[0]
      ?.closest('[data-slot="thread-actions"]') as HTMLElement;
    const classes = actions.className.split(/\s+/);
    expect(classes).toContain('[@media(hover:hover)]:group-hover/thread:opacity-100');
    expect(classes.some((c) => /(^|:)group-hover:/.test(c))).toBe(false);
    expect(classes).toContain('[@media(hover:hover)]:absolute');
    expect((actions.parentElement as HTMLElement).className).toContain('group/thread');
  });
});

/**
 * Message search. The merged list holds every thread the harness returned, so a
 * hit is almost always on a listed thread — and the first version kept only hits
 * on threads it did *not* list, so it showed none of them and said "No matches"
 * about a word the harness had found.
 */
describe('searching message text', () => {
  const other = thread({ id: 't2', title: 'Release checklist' });

  it('lists a thread whose messages matched, with the words that did', async () => {
    search.mockResolvedValue([
      { thread_id: 'default:t2', content: 'please update the README before the tag' },
    ]);
    const { user } = setup({ threads: [thread(), other] });
    await user.type(screen.getByRole('searchbox', { name: 'Search threads' }), 'readme');
    const row = await screen.findByRole('button', { name: /^Release checklist/ });
    expect(row.textContent).toContain('README');
    expect(row.querySelector('mark')?.textContent).toBe('README');
    expect(screen.queryByText(/No thread matches/)).toBeNull();
  });

  it('says the message search failed rather than that nothing matched', async () => {
    search.mockRejectedValue(new Error('503'));
    const { user } = setup({ threads: [thread(), other] });
    await user.type(screen.getByRole('searchbox', { name: 'Search threads' }), 'zzz');
    expect(await screen.findByText(/Message search failed/)).toBeTruthy();
  });

  it('says it is still searching messages while title matches are already shown', async () => {
    search.mockReturnValue(new Promise(() => {}));
    const { user } = setup({ threads: [thread(), other] });
    await user.type(screen.getByRole('searchbox', { name: 'Search threads' }), 'release');
    expect(screen.getByText('Release checklist')).toBeTruthy();
    expect(await screen.findByText('Searching message text…')).toBeTruthy();
  });

  it('opens the first result on Enter', async () => {
    const { user, onSelect } = setup({ threads: [thread(), other] });
    await user.type(screen.getByRole('searchbox', { name: 'Search threads' }), 'release{Enter}');
    expect(onSelect).toHaveBeenCalledWith('t2');
  });
});

/** An instrument ranks by state first: a thread waiting on a person is never folded away. */
describe('grouping by state', () => {
  const old = Date.now() - 30 * 86_400_000;

  it('lifts a waiting thread out of a folded Older, above Pinned', () => {
    setup({
      threads: [
        thread({ id: 'p', title: 'Pinned one' }),
        thread({ id: 'w', title: 'Old but blocked', updatedAt: old }),
      ],
      currentId: 'x',
      pinned: new Set(['p']),
      blocked: new Set(['w']),
    });
    const groups = screen.getAllByRole('group').map((g) => g.getAttribute('aria-labelledby'));
    const first = screen.getAllByRole('group')[0] as HTMLElement;
    expect(groups.length).toBe(2);
    expect(first.textContent).toContain('Waiting on you');
    expect(first.textContent).toContain('Old but blocked');
  });

  it('keeps the current thread visible in a folded Older without holding the rest open', async () => {
    const { user } = setup({
      threads: [
        thread({ id: 'a', title: 'Old current', updatedAt: old }),
        thread({ id: 'b', title: 'Old other', updatedAt: old - 1 }),
      ],
      currentId: 'a',
    });
    expect(screen.getByText('Old current')).toBeTruthy();
    expect(screen.queryByText('Old other')).toBeNull();
    // The fold still works, rather than being disabled while it holds the current thread.
    const older = screen.getByRole('button', { name: /^Older/ });
    expect(older.hasAttribute('disabled')).toBe(false);
    await user.click(older);
    expect(screen.getByText('Old other')).toBeTruthy();
  });

  it('groups a thread with a live run under Running, below Waiting', () => {
    setup({
      threads: [thread(), thread({ id: 'w', title: 'Blocked one' })],
      running: new Set(['t1']),
      blocked: new Set(['w']),
    });
    const groups = screen.getAllByRole('group');
    expect(groups[0]?.textContent).toContain('Waiting on you');
    expect(groups[1]?.textContent).toMatch(/^Running/);
    expect(groups[1]?.textContent).toContain('Local title');
  });

  it('marks a running thread in words where it is not under its own group', async () => {
    const { user } = setup({ threads: [thread()], running: new Set(['t1']) });
    await user.type(screen.getByRole('searchbox', { name: 'Search threads' }), 'local');
    expect(screen.getByRole('button', { name: /^Local title/ }).textContent).toContain('Running');
  });

  it('cuts Older into months, each with its count', async () => {
    const now = new Date(2026, 9, 7).getTime();
    vi.setSystemTime(now);
    try {
      const { user } = setup({
        threads: [
          thread({ id: 's', title: 'September one', updatedAt: new Date(2026, 8, 10).getTime() }),
          thread({ id: 'a', title: 'August one', updatedAt: new Date(2026, 7, 3).getTime() }),
          thread({ id: 'b', title: 'August two', updatedAt: new Date(2026, 7, 2).getTime() }),
        ],
        currentId: 'x',
      });
      await user.click(screen.getByRole('button', { name: /^Older/ }));
      const september = screen.getByRole('group', { name: /^September/ });
      const august = screen.getByRole('group', { name: /^August/ });
      expect(september.textContent).toContain('September one');
      expect(august.textContent).toContain('August two');
      expect(august.textContent).not.toContain('September one');
    } finally {
      vi.useRealTimers();
    }
  });
});

/** The list is one Tab stop: three per row put 167 between the search and the workspace. */
describe('the keyboard', () => {
  const three = [
    thread({ id: 'a', title: 'Alpha' }),
    thread({ id: 'b', title: 'Bravo', updatedAt: Date.now() - 1 }),
    thread({ id: 'c', title: 'Charlie', updatedAt: Date.now() - 2 }),
  ];

  it('gives the list one Tab stop and walks it with the arrow keys', async () => {
    const { user } = setup({ threads: three, currentId: 'b' });
    const rows = document.querySelectorAll<HTMLElement>('[data-thread-row]');
    expect([...rows].map((r) => r.tabIndex)).toEqual([-1, 0, -1]);
    expect(
      screen.getAllByRole('button', { name: /^Actions for/ }).every((b) => b.tabIndex === -1),
    ).toBe(true);
    rows[1]?.focus();
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(rows[2]);
    await user.keyboard('{Home}');
    expect(document.activeElement).toBe(rows[0]);
  });

  it('enters the results from the search field with ↓', async () => {
    const { user } = setup({ threads: three, currentId: 'x' });
    await user.click(screen.getByRole('searchbox', { name: 'Search threads' }));
    await user.keyboard('{ArrowDown}');
    expect(document.activeElement?.getAttribute('data-thread-row')).toBe('a');
  });

  it("reaches a row's actions with →, and deletes with Delete", async () => {
    const { user, onDelete } = setup({ threads: three, currentId: 'x' });
    document.querySelector<HTMLElement>('[data-thread-row="a"]')?.focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement?.getAttribute('aria-label')).toBe('Actions for Alpha');
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement?.getAttribute('data-thread-row')).toBe('a');
    await user.keyboard('{Delete}');
    expect(onDelete).toHaveBeenCalledWith('a');
  });

  it('does not rename to the name it already has on Enter', async () => {
    const { user, onRename } = setup({ threads: [thread({ title: 'Same', named: true })] });
    await openMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));
    const field = await screen.findByLabelText('Thread name');
    await waitFor(() => expect(document.activeElement).toBe(field));
    await user.keyboard('{Enter}');
    expect(onRename).not.toHaveBeenCalled();
  });
});

/**
 * Deleting a thread with a run going stops the run at once, and Undo brings the
 * transcript back but never the run — so that one, and only that one, asks.
 */
describe('deleting a thread something is happening on', () => {
  it('asks before deleting a thread with a live run, by the key or the menu', async () => {
    const { user, onDelete } = setup({
      threads: [thread({ id: 'a', title: 'Alpha' })],
      currentId: 'x',
      running: new Set(['a']),
    });
    document.querySelector<HTMLElement>('[data-thread-row="a"]')?.focus();
    await user.keyboard('{Delete}');
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('Deleting stops the run on “Alpha”.')).toBeTruthy();
    await user.keyboard('{Escape}');
    expect(screen.queryByText(/Deleting stops the run/)).toBeNull();

    await openMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await user.click(await screen.findByRole('button', { name: 'Stop and delete' }));
    expect(onDelete).toHaveBeenCalledWith('a');
  });

  it('asks for a thread something is waiting on, and not for an idle one', async () => {
    const { user, onDelete } = setup({
      threads: [thread({ id: 'w', title: 'Blocked' }), thread({ id: 'i', title: 'Idle' })],
      currentId: 'x',
      blocked: new Set(['w']),
    });
    document.querySelector<HTMLElement>('[data-thread-row="w"]')?.focus();
    await user.keyboard('{Delete}');
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByText('“Blocked” has something waiting on you.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Keep' }));

    document.querySelector<HTMLElement>('[data-thread-row="i"]')?.focus();
    await user.keyboard('{Delete}');
    expect(onDelete).toHaveBeenCalledWith('i');
  });
});

describe('search, past its first page', () => {
  it('says when the message matches were capped, and asks for more', async () => {
    search.mockImplementation(async (_q: string, limit = 12) =>
      Array.from({ length: limit }, (_, i) => ({ thread_id: `default:h${i}`, content: 'readme' })),
    );
    const { user } = setup({ threads: [thread()] });
    await user.type(screen.getByRole('searchbox', { name: 'Search threads' }), 'readme');
    expect(await screen.findByText('Showing the first 12 message matches.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Search more' }));
    expect(await screen.findByText('Showing the first 50 message matches.')).toBeTruthy();
    expect(search).toHaveBeenLastCalledWith('readme', 50);
    expect(screen.queryByRole('button', { name: 'Search more' })).toBeNull();
  });

  it('keeps how long ago beside a matched message', async () => {
    search.mockResolvedValue([{ thread_id: 'default:t2', content: 'the README line' }]);
    const { user } = setup({ threads: [thread(), thread({ id: 't2', title: 'Other' })] });
    await user.type(screen.getByRole('searchbox', { name: 'Search threads' }), 'readme');
    const row = await screen.findByRole('button', { name: /^Other/ });
    expect(row.textContent).toContain('README');
    expect(row.textContent).toMatch(/· just now/);
  });
});
