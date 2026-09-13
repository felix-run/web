// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Inspector } from '../src/components/inspector/inspector';
import { WorkspaceZone } from '../src/components/workspace/workspace-zone';
import { ShellProvider, type ShellValue } from '../src/shell-context';

/**
 * The three-zone shell, at the two seams that can strand a control.
 *
 * The thread rail is gone: threads hang off the workspace header now. That makes
 * the popover the *only* way to reach another conversation at any width, so a
 * break there is not a degraded rail, it is a thread list with no door. And the
 * instrument became tabs, where exactly one section may be mounted — the poll
 * economy that justified tabs is only real if the other two are not running.
 */

vi.mock('../src/lib/cowork', () => ({
  getMountLabel: () => null,
  hasMount: () => false,
  mountTree: async () => [],
  vfs: { tree: () => [] },
  restoreMount: async () => ({ status: 'none' }),
  reconnectMount: async () => null,
  pickDirectory: async () => 'picked',
  clearMount: () => {},
  supportsDirectoryPicker: () => false,
  collectToolCallPaths: (args: unknown) => {
    const path = (args as { path?: string } | null)?.path;
    return path?.includes('/') ? [path] : [];
  },
}));

const thread = (id: string, title: string) => ({
  id,
  title,
  manifest: 'cowork',
  updatedAt: Date.now(),
});

function shell(over: Partial<ShellValue> = {}): ShellValue {
  return {
    turns: [],
    streaming: false,
    reattaching: false,
    error: null,
    sessionPhase: null,
    skills: null,
    pending: null,
    queueLength: 0,
    onDecide: async () => {},
    uiPrompt: null,
    uiResolving: false,
    onUiRespond: () => {},
    onUiCancel: () => {},
    threadId: 'now',
    labels: {},
    labelTurn: () => {},
    send: () => {},
    submit: () => {},
    stopRun: () => {},
    regenerate: () => {},
    rewindTo: () => {},
    onSlashCommand: () => {},
    threads: [thread('now', 'Current thread'), thread('other', 'The other one')],
    selectThread: () => {},
    newThread: () => {},
    deleteThread: () => {},
    renameThread: () => {},
    forkThread: () => {},
    compactThread: () => {},
    exportThread: () => {},
    manifest: 'cowork',
    setManifest: () => {},
    manifestOptions: ['cowork'],
    refreshCanary: () => {},
    verbose: false,
    harnessReachable: true,
    historyOpen: true,
    setHistoryOpen: () => {},
    inspectorOpen: true,
    setInspectorOpen: () => {},
    ...over,
  } as ShellValue;
}

function mountZone(over: Partial<ShellValue> = {}) {
  return render(
    <TooltipProvider>
      <ShellProvider value={shell(over)}>
        <WorkspaceZone />
      </ShellProvider>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ requests: [], items: [] }), { status: 200 })),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the workspace zone', () => {
  it('names the current thread on the popover trigger', async () => {
    mountZone();
    await waitFor(() => expect(screen.getByText('Current thread')).toBeTruthy());
  });

  /**
   * The rail is gone, so this popover is the only door to another conversation.
   * If it stops opening, every thread but the current one becomes unreachable at
   * every width — the exact "reachable in one layout, missing in the other"
   * failure the drawer pairs exist to prevent, except with no other layout.
   */
  it('opens the thread list, which is now the only way to reach another thread', async () => {
    mountZone();
    const trigger = await screen.findByText('Current thread');
    await act(async () => {
      await userEvent.click(trigger);
    });
    await waitFor(() => expect(screen.getByText('The other one')).toBeTruthy());
  });

  it('lists what this session touched, from the tool calls themselves', async () => {
    mountZone({
      turns: [
        {
          id: 't1',
          role: 'assistant',
          content: '',
          tools: [
            { name: 'write_file', input: { path: 'notes/one.md' }, done: true },
            { name: 'write_file', input: { path: 'notes/one.md' }, done: true },
            { name: 'read_file', input: { path: 'src/two.ts' }, done: true },
            // A bare name is still a path when it is a file tool's own `path`
            // argument. This is the write-to-the-workspace-root case, which the
            // mention heuristic drops and this panel exists to report.
            { name: 'write_file', input: { path: 'bare.md' }, done: true },
            // Not a path, and nothing should invent one from it.
            { name: 'local_shell', input: { command: 'echo hi' }, done: true },
          ],
        },
      ] as ShellValue['turns'],
    });

    await waitFor(() => expect(screen.getByText('Touched this session')).toBeTruthy());
    expect(screen.getByText('notes/one.md')).toBeTruthy();
    expect(screen.getByText('src/two.ts')).toBeTruthy();
    expect(screen.getByText('bare.md')).toBeTruthy();
    expect(screen.queryByText('echo hi')).toBeNull();
    // Deduped, not listed once per call.
    expect(screen.getAllByText('notes/one.md')).toHaveLength(1);
  });

  it('says nothing about touched files when no tool has run', async () => {
    mountZone();
    await waitFor(() => expect(screen.getByText('Files')).toBeTruthy());
    expect(screen.queryByText('Touched this session')).toBeNull();
  });
});

describe('the run instrument', () => {
  /**
   * The tab strip is a real tab widget, not roles painted on buttons.
   *
   * It used to carry `role="tablist"` and `aria-selected` with **no** `tabpanel`,
   * no `aria-controls` and no arrow-key roving focus — which announces a widget
   * and then does not behave like one, and is worse than plain buttons. It uses
   * `@felix/ui/tabs` now, and these assert the contract that made the roles
   * honest rather than the roles themselves.
   */
  it('associates every tab with a panel, both ways', async () => {
    render(
      <TooltipProvider>
        <Inspector open onClose={() => {}} />
      </TooltipProvider>,
    );

    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Approvals', 'Plans', 'Tools']);

    for (const tab of tabs) {
      const id = tab.getAttribute('aria-controls');
      expect(id).toBeTruthy();
      const panel = document.getElementById(id as string);
      expect(panel?.getAttribute('role')).toBe('tabpanel');
      // And back: the panel names the tab that controls it.
      expect(panel?.getAttribute('aria-labelledby')).toBe(tab.id);
    }
  });

  /**
   * Roving tabindex — one stop for the strip, arrows within it — is **not**
   * asserted here. Radix sets it from a real focus environment, and happy-dom
   * leaves every trigger at `-1`, so a test would be asserting the environment
   * rather than the widget. Verified in a browser instead: at rest the selected
   * trigger is `0` and the other two `-1`, and ArrowRight moves focus and
   * selection together.
   */
  it('mounts exactly one section at a time, which is what tabs bought', async () => {
    render(
      <TooltipProvider>
        <Inspector open onClose={() => {}} />
      </TooltipProvider>,
    );

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Approvals' })).toBeTruthy());
    expect(screen.getByRole('tab', { name: 'Approvals' }).getAttribute('aria-selected')).toBe(
      'true',
    );

    // An inactive panel renders its element for the association and *not* its
    // children — which is the poll economy, not a rendering detail.
    const inactive = [...document.querySelectorAll('[role=tabpanel][data-state=inactive]')];
    expect(inactive.length).toBeGreaterThan(0);
    for (const panel of inactive) expect(panel.childElementCount).toBe(0);

    await act(async () => {
      await userEvent.click(screen.getByRole('tab', { name: 'Plans' }));
    });
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Plans' }).getAttribute('aria-selected')).toBe('true'),
    );
    expect(screen.getByRole('tab', { name: 'Approvals' }).getAttribute('aria-selected')).toBe(
      'false',
    );
  });
});
