// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceZone } from '../src/components/workspace/workspace-zone';
import { ShellProvider, type ShellValue } from '../src/shell-context';

/**
 * The workspace header's grammar: icon · title · one value, like every header.
 *
 * The value slot held the Mount *action*, so the header said what to do rather
 * than what is mounted — and in the narrow drawer that button sat against the
 * drawer's close X. The value is the mount state now, and the actions are a row
 * of their own. The File System Access calls behind them are unchanged, which is
 * why they are doubles here: what is pinned is which control calls which.
 */

const fs = vi.hoisted(() => ({
  label: null as string | null,
  restore: { status: 'none' } as { status: string; name?: string },
  pick: vi.fn(async () => 'picked'),
  clear: vi.fn(),
  reconnect: vi.fn(async () => null as string | null),
}));

vi.mock('../src/lib/cowork', () => ({
  getMountLabel: () => fs.label,
  hasMount: () => fs.label !== null,
  mountTree: async () => [],
  vfs: { tree: () => [] },
  restoreMount: async () => fs.restore,
  reconnectMount: fs.reconnect,
  pickDirectory: fs.pick,
  clearMount: fs.clear,
  supportsDirectoryPicker: () => true,
  collectTouchedPaths: () => [],
}));

function mount() {
  const value = {
    turns: [],
    threads: [],
    threadId: 'now',
    streaming: false,
    selectThread: () => {},
    newThread: () => {},
    deleteThread: () => {},
    renameThread: () => {},
    forkThread: () => {},
    compactThread: () => {},
    exportThread: () => {},
    tenantApprovals: {
      pending: [],
      error: null,
      lastOkAt: Date.now(),
      failures: 0,
      refresh: () => {},
      markDecided: () => {},
    },
  } as unknown as ShellValue;
  return render(
    <TooltipProvider>
      <ShellProvider value={value}>
        <WorkspaceZone />
      </ShellProvider>
    </TooltipProvider>,
  );
}

/** The header row: everything up to the line under it. */
function headerRow(): HTMLElement {
  const heading = screen.getByRole('heading', { level: 2 });
  return heading.parentElement as HTMLElement;
}

beforeEach(() => {
  fs.label = null;
  fs.restore = { status: 'none' };
  fs.pick.mockClear();
  fs.clear.mockClear();
  fs.reconnect.mockClear();
});

afterEach(() => cleanup());

describe('the workspace header', () => {
  it('says what is mounted in the value slot, and holds no control', () => {
    fs.label = 'felix-web';
    mount();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Workspace');
    const value = screen.getByText('felix-web');
    expect(value.className.split(/\s+/)).toContain('font-mono');
    expect(headerRow().contains(value)).toBe(true);
    // Nothing clickable in the row the drawer's close button shares.
    expect(headerRow().querySelector('button')).toBeNull();
    expect(screen.getByRole('complementary', { name: 'Workspace felix-web' })).toBeTruthy();
  });

  it('reads in-tab when no folder is mounted, with Mount offered below rather than in it', async () => {
    mount();
    expect(headerRow().textContent).toContain('in-tab');
    expect(headerRow().querySelector('button')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Mount a folder' }));
    expect(fs.pick).toHaveBeenCalledOnce();
    await waitFor(() => expect(headerRow().textContent).toContain('picked'));
  });

  it('offers Change folder and Disconnect once mounted, each doing what it says', async () => {
    fs.label = 'felix-web';
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(fs.clear).toHaveBeenCalledOnce();
    await waitFor(() => expect(headerRow().textContent).toContain('in-tab'));
  });

  it('re-picks through the directory picker on Change folder', async () => {
    fs.label = 'felix-web';
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Change folder' }));
    expect(fs.pick).toHaveBeenCalledOnce();
    await waitFor(() => expect(headerRow().textContent).toContain('picked'));
  });

  it('keeps a folder awaiting permission out of the value until it is reconnected', async () => {
    fs.restore = { status: 'needs-permission', name: 'notes' };
    mount();
    const reconnect = await screen.findByRole('button', { name: 'Reconnect notes' });
    expect(headerRow().textContent).toContain('in-tab');
    await userEvent.click(reconnect);
    expect(fs.reconnect).toHaveBeenCalledOnce();
  });
});
