// @vitest-environment happy-dom
import { SidebarProvider } from '@felix/ui/sidebar';
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FilesView } from '../src/components/pane/files-view';
import { WorkspaceRow } from '../src/components/workspace/workspace-section';
import { resetMountState } from '../src/lib/mount-state';
import { paneState, resetPanes } from '../src/lib/side-pane';
import { ShellProvider, type ShellValue } from '../src/shell-context';

/**
 * The workspace in two places: one sidebar row that says what is mounted and
 * opens Files, and the Files tab's header, which holds the mount controls.
 *
 * Both read one mount store (`lib/mount-state.ts`), so mounting from one is
 * seen in the other. The File System Access calls behind them are doubles here:
 * what is pinned is which control calls which, and what each surface says.
 */

const fs = vi.hoisted(() => ({
  label: null as string | null,
  picker: true,
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
  supportsDirectoryPicker: () => fs.picker,
  collectTouchedPaths: () => [],
}));

// The harness's tree, for the agents whose tools are there: empty, and asked of no network.
vi.mock('../src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api')>()),
  workspaceTree: async () => ({ entries: [], rootKind: 'workspace', truncated: false }),
}));

type Tools = 'server' | 'client' | 'both' | 'none' | undefined;

function shell(tools: Tools, openInPane = vi.fn()) {
  return {
    turns: [],
    threads: [],
    threadId: 'now',
    streaming: false,
    watching: false,
    manifest: 'agent',
    manifestEntries: tools ? [{ id: 'agent', workspace: { tools, scope: 'thread' } }] : [],
    openInPane,
  } as unknown as ShellValue;
}

function mountRow(tools: Tools = 'client', openInPane = vi.fn(), collapsed = false) {
  return render(
    <TooltipProvider>
      <SidebarProvider
        open={!collapsed}
        onOpenChange={() => {}}
        openMobile={false}
        onOpenMobileChange={() => {}}
        mobile={false}
      >
        <ShellProvider value={shell(tools, openInPane)}>
          <WorkspaceRow collapsed={collapsed} onNavigate={() => {}} />
        </ShellProvider>
      </SidebarProvider>
    </TooltipProvider>,
  );
}

function mountFiles(tools: Tools = 'client') {
  return render(
    <TooltipProvider>
      <ShellProvider value={shell(tools)}>
        <FilesView />
      </ShellProvider>
    </TooltipProvider>,
  );
}

/** The Files tab's header: the heading and what sits beside it. */
function filesHeader(): HTMLElement {
  return screen.getByRole('heading', { level: 2 }).closest('header') as HTMLElement;
}

beforeEach(() => {
  fs.label = null;
  fs.picker = true;
  fs.restore = { status: 'none' };
  fs.pick.mockClear();
  fs.clear.mockClear();
  fs.reconnect.mockClear();
  resetPanes();
  resetMountState();
});

afterEach(() => cleanup());

describe('the sidebar Workspace row', () => {
  it('says what is mounted, in mono, and opens Files', async () => {
    fs.label = 'felix-web';
    resetMountState();
    const open = vi.fn();
    mountRow('client', open);
    const value = screen.getByText('felix-web');
    expect(value.className.split(/\s+/)).toContain('font-mono');
    await userEvent.click(screen.getByRole('button', { name: /Workspace/ }));
    expect(open).toHaveBeenCalledWith({ kind: 'files' });
  });

  it('reads in-tab with no folder, and on the harness for an agent whose tools are there', () => {
    mountRow('client');
    expect(screen.getByText('in-tab')).toBeTruthy();
    cleanup();
    mountRow('server');
    expect(screen.getByText('on the harness')).toBeTruthy();
  });

  it('is not drawn for an agent with no file tools', () => {
    const { container } = mountRow('none');
    expect(container.querySelector('[data-slot="workspace-row"]')).toBeNull();
  });

  it('is drawn when the catalog says nothing, as before the key existed', () => {
    mountRow(undefined);
    expect(screen.getByText('in-tab')).toBeTruthy();
  });

  it('offers Reconnect beside the row — a separate control — when a folder waits on permission', async () => {
    fs.restore = { status: 'needs-permission', name: 'notes' };
    mountRow('client');
    const reconnect = await screen.findByRole('button', { name: 'Reconnect notes' });
    // Beside the row, not inside it: a button in a button is two controls as one.
    expect(reconnect.closest('[data-sidebar="menu-button"]')).toBeNull();
    await userEvent.click(reconnect);
    expect(fs.reconnect).toHaveBeenCalledOnce();
  });
});

describe('the Files tab header', () => {
  it('names the mounted folder and offers Change folder and Disconnect', async () => {
    fs.label = 'felix-web';
    resetMountState();
    mountFiles();
    expect(filesHeader().textContent).toContain('felix-web');
    expect(filesHeader().textContent).toContain('Client tools run against this folder');
    await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(fs.clear).toHaveBeenCalledOnce();
    await waitFor(() =>
      expect(filesHeader().textContent).toContain('Client tools run in this tab'),
    );
  });

  it('mounts through the directory picker, and the row sees it too', async () => {
    mountFiles();
    await userEvent.click(screen.getByRole('button', { name: 'Mount a folder' }));
    expect(fs.pick).toHaveBeenCalledOnce();
    await waitFor(() => expect(filesHeader().textContent).toContain('picked'));
    cleanup();
    mountRow('client');
    expect(screen.getByText('picked')).toBeTruthy();
  });

  it('re-picks on Change folder', async () => {
    fs.label = 'felix-web';
    resetMountState();
    mountFiles();
    await userEvent.click(screen.getByRole('button', { name: 'Change folder' }));
    expect(fs.pick).toHaveBeenCalledOnce();
    await waitFor(() => expect(filesHeader().textContent).toContain('picked'));
  });

  it('offers Reconnect for a folder awaiting permission', async () => {
    fs.restore = { status: 'needs-permission', name: 'notes' };
    mountFiles();
    await userEvent.click(await screen.findByRole('button', { name: 'Reconnect notes' }));
    expect(fs.reconnect).toHaveBeenCalledOnce();
  });

  it('says why there is no Mount where the browser has no directory picker', () => {
    // Safari, Firefox, and so every iPhone and iPad: the buttons cannot exist, and
    // without a line saying so their absence read as a feature that was missing.
    fs.picker = false;
    mountFiles();
    expect(screen.queryByRole('button', { name: 'Mount a folder' })).toBeNull();
    expect(screen.getByText(/Mounting a folder needs Chrome or Edge/)).toBeTruthy();
  });

  it('holds no mount controls for an agent whose file tools are on the harness', () => {
    mountFiles('server');
    expect(screen.queryByRole('button', { name: 'Mount a folder' })).toBeNull();
    expect(filesHeader().textContent).toContain('File tools run on the harness');
  });
});

describe('Files in the pane', () => {
  it('is pinned first, outside the limit, and a closed one is not reopened by a write', async () => {
    const { addFilesTab, closePaneItem, openInPane, PANE_LIMIT } = await import(
      '../src/lib/side-pane'
    );
    for (let i = 0; i < PANE_LIMIT; i++) openInPane('t', { kind: 'file', path: `f${i}` });
    addFilesTab('t', { show: true });
    expect(paneState('t').items[0]?.kind).toBe('files');
    expect(paneState('t').items).toHaveLength(PANE_LIMIT + 1);
    openInPane('t', { kind: 'file', path: 'one-more' });
    // The oldest file went, never Files.
    expect(paneState('t').items[0]?.kind).toBe('files');
    expect(paneState('t').items.some((i) => i.key === 'file:f0')).toBe(false);
    closePaneItem('t', 'files');
    addFilesTab('t', { show: true });
    expect(paneState('t').items.some((i) => i.kind === 'files')).toBe(false);
    // An explicit open still works.
    openInPane('t', { kind: 'files' });
    expect(paneState('t').items[0]?.kind).toBe('files');
  });

  it('waits behind an open instrument rather than taking the zone', async () => {
    const { addFilesTab } = await import('../src/lib/side-pane');
    addFilesTab('u', { show: false });
    expect(paneState('u').items[0]?.kind).toBe('files');
    expect(paneState('u').shown).toBe(false);
  });
});
