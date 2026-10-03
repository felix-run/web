// @vitest-environment happy-dom
import { SidebarProvider } from '@felix/ui/sidebar';
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { AppSidebar } from '../src/components/app-sidebar';
import { Inspector } from '../src/components/inspector/inspector';
import { ThemeProvider } from '../src/components/theme-provider';
import { WorkspaceSection } from '../src/components/workspace/workspace-section';
import { Workbench } from '../src/routes/workbench';
import { ShellProvider, type ShellValue } from '../src/shell-context';

/**
 * The three-zone shell, at the two seams that can strand a control.
 *
 * The sidebar is the one door to every other conversation, at every width —
 * inline, collapsed to icons, or as the drawer — so a break there is not a
 * degraded rail, it is a thread list with no door. And the instrument became tabs, where exactly one section may be mounted — the poll
 * economy that justified tabs is only real if the other two are not running.
 */

vi.mock('../src/lib/cowork', async () => ({
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
  // The real one: which arguments count as "touched" is the rule under test.
  collectTouchedPaths: (
    await vi.importActual<typeof import('@felix/cowork-client/tool-call-paths')>(
      '@felix/cowork-client/tool-call-paths',
    )
  ).collectTouchedPaths,
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
    tenantApprovals: {
      pending: [],
      error: null,
      lastOkAt: Date.now(),
      failures: 0,
      refresh: () => {},
      markDecided: () => {},
    },
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
    editTurn: async () => {},
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
    manifestEntries: [],
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

function mountSidebar(
  over: Partial<ShellValue> = {},
  { open = true, mobile = false }: { open?: boolean; mobile?: boolean } = {},
) {
  return render(
    <MemoryRouter initialEntries={['/t/now']}>
      <TooltipProvider>
        <ShellProvider value={shell(over)}>
          <SidebarProvider
            open={open}
            onOpenChange={() => {}}
            openMobile={mobile}
            onOpenMobileChange={() => {}}
            mobile={mobile}
          >
            <AppSidebar />
          </SidebarProvider>
        </ShellProvider>
      </TooltipProvider>
    </MemoryRouter>,
  );
}

function mountZone(over: Partial<ShellValue> = {}) {
  return render(
    <TooltipProvider>
      <ShellProvider value={shell(over)}>
        <WorkspaceSection />
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

describe('the sidebar', () => {
  /**
   * The threads popover was the only door to another conversation; the sidebar
   * is that door now, at every width — inline, as icons, or as the drawer. If its
   * list stops rendering, every thread but the current one is unreachable.
   */
  it('lists every thread, and marks the one on screen', async () => {
    mountSidebar();
    const current = await screen.findByRole('button', { name: /^Current thread/ });
    expect(current.getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('button', { name: /^The other one/ })).toBeTruthy();
  });

  it('marks a thread an approval is waiting on, from the shell poll it already has', async () => {
    mountSidebar({
      tenantApprovals: {
        pending: [{ id: 'a1', thread_id: 'other', tool_name: 'write_file' }],
        error: null,
        lastOkAt: Date.now(),
        refresh: () => {},
      } as unknown as ShellValue['tenantApprovals'],
    });
    const row = (await screen.findByText('The other one')).closest('button');
    expect(row?.textContent).toContain('Waiting on you');
    const current = screen.getByText('Current thread').closest('button');
    expect(current?.textContent).not.toContain('Waiting on you');
  });

  it('groups by last activity, and starts Older folded with its count', async () => {
    const day = 86_400_000;
    mountSidebar({
      threads: [
        { ...thread('now', 'Current thread') },
        { ...thread('week', 'Earlier this week'), updatedAt: Date.now() - 3 * day },
        { ...thread('old', 'Last quarter'), updatedAt: Date.now() - 90 * day },
      ],
    });
    expect(await screen.findByRole('group', { name: 'Today' })).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Previous 7 days' })).toBeTruthy();
    const older = screen.getByRole('button', { name: /^Older/ });
    expect(older.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Last quarter')).toBeNull();
    await act(async () => userEvent.click(older));
    expect(screen.getByText('Last quarter')).toBeTruthy();
  });

  it('never folds away the thread on screen', async () => {
    mountSidebar({
      threadId: 'old',
      threads: [
        thread('now', 'Recent'),
        { ...thread('old', 'Last quarter'), updatedAt: Date.now() - 90 * 86_400_000 },
      ],
    });
    const row = await screen.findByRole('button', { name: /^Last quarter/ });
    expect(row.getAttribute('aria-current')).toBe('page');
  });

  it('pins a thread above the dates, and remembers it in this browser', async () => {
    mountSidebar();
    await act(async () =>
      userEvent.click(screen.getByRole('button', { name: 'Actions for The other one' })),
    );
    await act(async () => userEvent.click(await screen.findByRole('menuitem', { name: 'Pin' })));
    const pinned = await screen.findByRole('group', { name: /^Pinned/ });
    expect(pinned.textContent).toContain('The other one');
    expect(JSON.parse(localStorage.getItem('felix.pinnedThreads') ?? '[]')).toEqual(['other']);
  });

  it('keeps every section reachable when collapsed to icons', async () => {
    mountSidebar({}, { open: false });
    expect(screen.queryByRole('searchbox', { name: 'Search threads' })).toBeNull();
    for (const name of ['New chat', 'Search threads', 'Threads', 'Workspace', 'Ledger']) {
      expect(
        screen.getByRole(name === 'Ledger' ? 'link' : 'button', { name: new RegExp(`^${name}`) }),
      ).toBeTruthy();
    } // The Harness label is faded out when collapsed; its fold button must not
    // linger as a Tab stop nobody can see.
    expect(screen.queryByRole('button', { name: 'Harness' })).toBeNull();
  });
});

describe('the workspace section', () => {
  it('lists what this thread changed, from the tool calls themselves', async () => {
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
            // A tool that touches no workspace file, whose *text* names some. On
            // `self-pr-306` these were listed as touched.
            {
              name: 'github__create_pull_request',
              input: {
                title: 'Deny control',
                body: 'Changes:\n- ./scripts/test.sh\n- tests/unit/test_audit_deny_control.py',
              },
              done: true,
            },
          ],
        },
      ] as ShellValue['turns'],
    });

    await waitFor(() => expect(screen.getByText('Changes on this thread')).toBeTruthy());
    // The row's text is split so the filename survives truncation; the full path
    // is its title.
    const rows = (path: string) => document.querySelectorAll(`[title="${path}"]`);
    expect(rows('notes/one.md')).toHaveLength(1); // deduped, not listed once per call
    expect(rows('src/two.ts')).toHaveLength(1);
    expect(rows('bare.md')).toHaveLength(1);
    expect(screen.queryByText('echo hi')).toBeNull();
    expect(rows('./scripts/test.sh')).toHaveLength(0);
    expect(rows('tests/unit/test_audit_deny_control.py')).toHaveLength(0);
    expect(document.body.textContent).not.toContain('scripts/test.sh');
  });

  it('says nothing about changes when no tool has run', async () => {
    mountZone();
    await waitFor(() => expect(screen.getByText('Files')).toBeTruthy());
    expect(screen.queryByText('Changes on this thread')).toBeNull();
  });
});

describe('the dropped-connection notice', () => {
  const notice = () => document.querySelector('[data-slot=marker][role=status]')?.textContent ?? '';
  const mountWorkbench = (over: Partial<ShellValue>) =>
    render(
      <TooltipProvider>
        <ShellProvider value={shell({ inspectorOpen: false, ...over })}>
          <Workbench />
        </ShellProvider>
      </TooltipProvider>,
    );

  it('says what is still landing while the thread is being rejoined', () => {
    mountWorkbench({ reattaching: true, dropped: true });
    expect(notice()).toContain('anything still landing');
  });

  /**
   * The rejoin after a dropped run is quick, and what it rebuilds often has no
   * reply, because the harness keeps none of a run it tore down. The notice has to
   * outlive it, or the operator is left with an unanswered question and no reason.
   */
  it('stays once the rejoin is over, and says nothing more is coming', () => {
    mountWorkbench({ reattaching: false, dropped: true });
    expect(notice()).toContain('Connection dropped');
    expect(notice()).toContain('Nothing more is coming');
    expect(notice()).not.toContain('still landing');
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
    expect(tabs.map((t) => t.textContent)).toEqual(['Plans', 'Tools']);

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

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Plans' })).toBeTruthy());
    expect(screen.getByRole('tab', { name: 'Plans' }).getAttribute('aria-selected')).toBe('true');

    // An inactive panel renders its element for the association and *not* its
    // children — which is the poll economy, not a rendering detail.
    const inactive = [...document.querySelectorAll('[role=tabpanel][data-state=inactive]')];
    expect(inactive.length).toBeGreaterThan(0);
    for (const panel of inactive) expect(panel.childElementCount).toBe(0);

    await act(async () => {
      await userEvent.click(screen.getByRole('tab', { name: 'Tools' }));
    });
    await waitFor(() =>
      expect(screen.getByRole('tab', { name: 'Tools' }).getAttribute('aria-selected')).toBe('true'),
    );
    expect(screen.getByRole('tab', { name: 'Plans' }).getAttribute('aria-selected')).toBe('false');
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

  it('caps the instrument drawer at the viewport', () => {
    render(
      <TooltipProvider>
        <ShellProvider value={shell({ historyOpen: false, inspectorOpen: true })}>
          <Workbench />
        </ShellProvider>
      </TooltipProvider>,
    );
    const drawer = document.querySelector('[data-slot="sheet-content"]');
    expect(drawer?.classList).toContain('max-w-full');
  });

  it('caps the sidebar drawer at the viewport', () => {
    mountSidebar({}, { mobile: true });
    const drawer = document.querySelector('[data-slot="sheet-content"]');
    expect(drawer?.getAttribute('data-shortcut-surface')).toBe('workspace');
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
  const button = (name: 'Sidebar' | 'This run') =>
    document.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`) as HTMLButtonElement;
  const toggle = async (name: 'Sidebar' | 'This run') => {
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
    expect(button('Sidebar').getAttribute('aria-pressed')).toBe('false');
    expect(button('This run').getAttribute('aria-pressed')).toBe('false');
    expect(stored()).toEqual(['1', '1']);
  });

  it('opens one drawer at a time, and never writes a drawer to the preference', async () => {
    localStorage.setItem('felix.historyOpen', '1');
    localStorage.setItem('felix.inspectorOpen', '1');
    await mountApp(390);

    const ws = await toggle('Sidebar');
    await waitFor(() => expect(drawer('workspace')).toBeTruthy());
    expect(ws.getAttribute('aria-pressed')).toBe('true');
    // The mark heads the drawer too, and closes it; the header behind keeps the
    // page's one `h1`, so the drawer's wordmark is not a second.
    expect(ws.closest('[data-slot="header-brand"]')).not.toBeNull();
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(drawer('workspace')?.querySelector('button[aria-label="Close sidebar"]')).toBeTruthy();

    const inst = await toggle('This run');
    await waitFor(() => expect(drawer('instrument')).toBeTruthy());
    expect(drawer('workspace')).toBeNull();
    expect(drawers()).toHaveLength(1);
    expect(inst.getAttribute('aria-pressed')).toBe('true');
    expect(ws.getAttribute('aria-pressed')).toBe('false');
    // Named for the heading it shows.
    expect(screen.getByRole('dialog', { name: 'This run' })).toBeTruthy();

    await toggle('This run');
    await waitFor(() => expect(drawers()).toHaveLength(0));
    expect(stored()).toEqual(['1', '1']);
  });

  it('persists a toggle made while the rail is inline', async () => {
    await mountApp(1400);
    expect(instrumentRail()).toBeNull();

    const inst = await toggle('This run');
    await waitFor(() => expect(instrumentRail()).toBeTruthy());
    expect(drawers()).toHaveLength(0);
    expect(inst.getAttribute('aria-pressed')).toBe('true');
    expect(localStorage.getItem('felix.inspectorOpen')).toBe('1');

    await toggle('This run');
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
    expect(button('This run').getAttribute('aria-pressed')).toBe('false');

    // A drawer opened here belongs to this width: widening hands back to the
    // stored rail, and narrowing again does not bring the drawer back with it.
    await toggle('This run');
    await waitFor(() => expect(drawer('instrument')).toBeTruthy());
    await resize(1400);
    await waitFor(() => expect(instrumentRail()).toBeTruthy());
    expect(drawers()).toHaveLength(0);
    await resize(1100);
    expect(drawers()).toHaveLength(0);
    expect(localStorage.getItem('felix.inspectorOpen')).toBe('1');
  });
});
