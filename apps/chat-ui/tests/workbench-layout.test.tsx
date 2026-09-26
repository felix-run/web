// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { Inspector } from '../src/components/inspector/inspector';
import { ThemeProvider } from '../src/components/theme-provider';
import { WorkspaceZone } from '../src/components/workspace/workspace-zone';
import { Workbench } from '../src/routes/workbench';
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
  // The shell hands these to the engine at mount; no test here runs a tool.
  executeClientTool: async () => ({}),
  readWorkspaceFile: async () => null,
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
    approvalQueue: [],
    bannerOwned: [],
    tenantApprovals: { pending: [], error: null, lastOkAt: Date.now(), refresh: () => {} },
    runClock: { startedAt: null, endedAt: null },
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

  /**
   * `mod+k` opens this to find a thread, and Radix lands on the first tabbable
   * element — which was New chat, the one control that leaves the thread you are
   * on. The shortcut clicks the trigger, so the click path is the shortcut path.
   */
  it('puts focus in the search field when the list opens, not on New chat', async () => {
    mountZone();
    const trigger = await screen.findByText('Current thread');
    await act(async () => {
      await userEvent.click(trigger);
    });
    const search = await screen.findByRole('searchbox', { name: 'Search sessions' });
    await waitFor(() => expect(document.activeElement).toBe(search));
  });

  it('marks a thread an approval is waiting on, from the shell poll it already has', async () => {
    mountZone({
      tenantApprovals: {
        pending: [{ id: 'a1', thread_id: 'other', tool_name: 'write_file' }],
        error: null,
        lastOkAt: Date.now(),
        refresh: () => {},
      } as unknown as ShellValue['tenantApprovals'],
    });
    await act(async () => {
      await userEvent.click(await screen.findByText('Current thread'));
    });
    const row = (await screen.findByText('The other one')).closest('button');
    expect(row?.textContent).toContain('Waiting on you');
    const current = screen.getAllByText('Current thread').at(-1)?.closest('button');
    expect(current?.textContent).not.toContain('Waiting on you');
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
        <ShellProvider value={shell()}>
          <Inspector open onClose={() => {}} />
        </ShellProvider>
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
        <ShellProvider value={shell()}>
          <Inspector open onClose={() => {}} />
        </ShellProvider>
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

describe('the narrow drawers', () => {
  /**
   * Below their breakpoints both zones are sheets with a fixed rem width, and the
   * primitive's own cap is `sm:`-only. Uncapped, the instrument's 22rem measured
   * 352px wide at `left: -32` on a 320px phone in Chromium — its title, first tab
   * and the start of every row off-screen. happy-dom has no layout, so this pins
   * the cap rather than the geometry; the geometry was measured in a browser.
   * Its window is 1024px wide by default, which already puts the workspace
   * inline, so `matchMedia` is stubbed to a phone.
   */
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
  });

  it.each([
    ['workspace', { historyOpen: true, inspectorOpen: false }],
    ['instrument', { historyOpen: false, inspectorOpen: true }],
  ])('caps the %s drawer at the viewport', (_, open) => {
    render(
      <TooltipProvider>
        <ShellProvider value={shell(open)}>
          <Workbench />
        </ShellProvider>
      </TooltipProvider>,
    );
    const drawer = document.querySelector('[data-slot="sheet-content"]');
    expect(drawer?.classList).toContain('max-w-full');
  });
});

describe('rail state across widths', () => {
  /**
   * The inline rail preference and the narrow drawer are two different things,
   * and only the first is remembered. One flag used to serve both: a thread at
   * 1100px loaded behind a modal instrument because the flag had been set on a
   * wide monitor, two drawers stacked over the transcript on a phone, and
   * closing either wrote `0` that collapsed the rail on the monitor.
   *
   * `matchMedia` is a width the test can move, and it notifies subscribers, so
   * a resize is the same event `useMediaQuery` hears in a browser.
   */
  let width = 1024;
  const listeners = new Set<() => void>();
  const resize = (next: number) =>
    act(() => {
      width = next;
      for (const fn of listeners) fn();
    });

  beforeEach(() => {
    listeners.clear();
    vi.stubGlobal('matchMedia', (query: string) => {
      const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1]);
      return {
        get matches() {
          return Number.isFinite(min) && width >= min;
        },
        media: query,
        addEventListener: (_: string, fn: () => void) => listeners.add(fn),
        removeEventListener: (_: string, fn: () => void) => listeners.delete(fn),
      };
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/chat/sessions')) {
          return new Response(JSON.stringify({ sessions: [], items: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ requests: [], items: [] }), { status: 200 });
      }),
    );
  });

  async function mountApp(at: number) {
    width = at;
    render(
      <MemoryRouter initialEntries={['/']}>
        <ThemeProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    await waitFor(() =>
      expect(document.querySelector('[data-shortcut-target="composer"]')).toBeTruthy(),
    );
  }

  const drawer = (zone: 'workspace' | 'instrument') =>
    document.querySelector(`[data-slot="sheet-content"][data-shortcut-surface="${zone}"]`);
  const drawers = () => document.querySelectorAll('[data-slot="sheet-content"]');
  /** The instrument as a column: its aside, outside any dialog. */
  const instrumentRail = () =>
    [...document.querySelectorAll('aside[aria-labelledby="inspector-heading"]')].find(
      (el) => !el.closest('[role="dialog"]'),
    ) ?? null;
  /**
   * Found by label rather than by role: with a modal drawer open, Radix hides
   * the rest of the page from the accessibility tree. And a real `click()`
   * rather than userEvent, which refuses to click through the `pointer-events:
   * none` the same modal sets. A keyboard shortcut reaches the same setter.
   */
  const button = (name: 'Toggle workspace' | 'Toggle run instrument') =>
    document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`) as HTMLButtonElement;
  const toggle = async (name: 'Toggle workspace' | 'Toggle run instrument') => {
    const el = button(name);
    await act(async () => el.click());
    return el;
  };
  const stored = () => [
    localStorage.getItem('felix.historyOpen'),
    localStorage.getItem('felix.inspectorOpen'),
  ];

  it('starts a narrow load with both drawers closed, whatever the desktop remembered', async () => {
    localStorage.setItem('felix.historyOpen', '1');
    localStorage.setItem('felix.inspectorOpen', '1');
    await mountApp(390);

    expect(drawers()).toHaveLength(0);
    expect(button('Toggle workspace').getAttribute('aria-pressed')).toBe('false');
    expect(button('Toggle run instrument').getAttribute('aria-pressed')).toBe('false');
    expect(stored()).toEqual(['1', '1']);
  });

  it('opens one drawer at a time, and never writes a drawer to the preference', async () => {
    localStorage.setItem('felix.historyOpen', '1');
    localStorage.setItem('felix.inspectorOpen', '1');
    await mountApp(390);

    const ws = await toggle('Toggle workspace');
    await waitFor(() => expect(drawer('workspace')).toBeTruthy());
    expect(ws.getAttribute('aria-pressed')).toBe('true');

    const inst = await toggle('Toggle run instrument');
    await waitFor(() => expect(drawer('instrument')).toBeTruthy());
    expect(drawer('workspace')).toBeNull();
    expect(drawers()).toHaveLength(1);
    expect(inst.getAttribute('aria-pressed')).toBe('true');
    expect(ws.getAttribute('aria-pressed')).toBe('false');
    // Named for the heading it shows.
    expect(screen.getByRole('dialog', { name: 'This run' })).toBeTruthy();

    await toggle('Toggle run instrument');
    await waitFor(() => expect(drawers()).toHaveLength(0));
    expect(stored()).toEqual(['1', '1']);
  });

  it('persists a toggle made while the rail is inline', async () => {
    await mountApp(1400);
    expect(instrumentRail()).toBeNull();

    const inst = await toggle('Toggle run instrument');
    await waitFor(() => expect(instrumentRail()).toBeTruthy());
    expect(drawers()).toHaveLength(0);
    expect(inst.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('felix.inspectorOpen')).toBe('1');

    await toggle('Toggle run instrument');
    await waitFor(() => expect(instrumentRail()).toBeNull());
    expect(localStorage.getItem('felix.inspectorOpen')).toBe('0');
  });

  it('does not pop a drawer on narrowing, and restores the rail on widening', async () => {
    localStorage.setItem('felix.inspectorOpen', '1');
    await mountApp(1400);
    await waitFor(() => expect(instrumentRail()).toBeTruthy());

    await resize(1100);
    expect(instrumentRail()).toBeNull();
    expect(drawers()).toHaveLength(0);
    expect(button('Toggle run instrument').getAttribute('aria-pressed')).toBe('false');

    // A drawer opened here belongs to this width: widening hands back to the
    // stored rail, and narrowing again does not bring the drawer back with it.
    await toggle('Toggle run instrument');
    await waitFor(() => expect(drawer('instrument')).toBeTruthy());
    await resize(1400);
    await waitFor(() => expect(instrumentRail()).toBeTruthy());
    expect(drawers()).toHaveLength(0);
    await resize(1100);
    expect(drawers()).toHaveLength(0);
    expect(localStorage.getItem('felix.inspectorOpen')).toBe('1');
  });
});
