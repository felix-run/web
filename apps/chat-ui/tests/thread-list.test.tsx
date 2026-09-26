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
    onNew: vi.fn(),
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
});
afterEach(cleanup);

describe('ThreadList actions', () => {
  it('offers the four per-thread actions', async () => {
    const { user } = setup();
    await openMenu(user);
    for (const label of ['Rename', 'Duplicate', 'Compact context', 'Export JSONL']) {
      expect(await screen.findByRole('menuitem', { name: label })).toBeTruthy();
    }
  });

  // The regression this file exists for.
  it('puts the caret in the rename field, not back on the menu trigger', async () => {
    const { user } = setup();
    await openMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));

    const field = await screen.findByLabelText('Conversation name');
    await waitFor(() => {
      expect(document.activeElement).toBe(field);
    });
  });

  it('commits a rename on Enter', async () => {
    const { user, onRename } = setup();
    await openMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));

    const field = await screen.findByLabelText('Conversation name');
    await waitFor(() => expect(document.activeElement).toBe(field));
    await user.keyboard('Quarterly review{Enter}');

    expect(onRename).toHaveBeenCalledWith('t1', 'Quarterly review');
  });

  it('abandons a rename on Escape', async () => {
    const { user, onRename } = setup();
    await openMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));

    const field = await screen.findByLabelText('Conversation name');
    await waitFor(() => expect(document.activeElement).toBe(field));
    await user.keyboard('discard me{Escape}');

    expect(onRename).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Conversation name')).toBeNull();
  });

  // Losing a typed name to a stray click is worse than an unintended rename,
  // which is undone by renaming again.
  it('commits rather than discards when the field loses focus', async () => {
    const { user, onRename } = setup();
    await openMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));

    const field = await screen.findByLabelText('Conversation name');
    await waitFor(() => expect(document.activeElement).toBe(field));
    await user.keyboard('typed then clicked away');
    await user.click(screen.getByRole('button', { name: 'New chat' }));

    expect(onRename).toHaveBeenCalledWith('t1', 'typed then clicked away');
  });

  it('does not fire a rename for an empty name', async () => {
    const { user, onRename } = setup();
    await openMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Rename' }));

    const field = await screen.findByLabelText('Conversation name');
    await waitFor(() => expect(document.activeElement).toBe(field));
    await user.keyboard('   {Enter}');

    expect(onRename).not.toHaveBeenCalled();
  });

  it('disables the server-backed actions for a local-only thread', async () => {
    const { user } = setup({ threads: [thread({ onServer: false })] });
    await openMenu(user);

    for (const label of ['Duplicate', 'Compact context', 'Export JSONL']) {
      const item = await screen.findByRole('menuitem', { name: label });
      expect(item.getAttribute('aria-disabled')).toBe('true');
    }
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
    const marked = screen.getByText('Other').closest('button');
    expect(marked?.textContent).toContain('Waiting on you');
    const unmarked = screen.getByText('Local title').closest('button');
    expect(unmarked?.textContent).not.toContain('Waiting on you');
  });

  it('finds a row by what it shows, including a fallback title', async () => {
    localStorage.setItem(
      'felix.turns:t9',
      JSON.stringify([{ id: 'u', role: 'user', content: 'Migrate the billing table' }]),
    );
    const { user } = setup({ threads: [thread(), untitled('t9')] });
    await user.type(screen.getByRole('searchbox', { name: 'Search sessions' }), 'billing');
    expect(screen.getByText('Migrate the billing table')).toBeTruthy();
    expect(screen.queryByText('Local title')).toBeNull();
  });
});
