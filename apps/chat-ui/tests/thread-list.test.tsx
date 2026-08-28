/** @vitest-environment happy-dom */

import type { ThreadMeta } from '@felix/client';
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

  it('shows an em dash when no manifest is known for a server-only thread', () => {
    setup({ threads: [thread({ manifest: '' })] });
    expect(screen.getByText(/—/)).toBeTruthy();
  });
});
