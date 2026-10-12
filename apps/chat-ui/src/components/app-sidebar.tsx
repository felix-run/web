import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
  useSidebar,
} from '@felix/ui/sidebar';
import {
  ActivityIcon,
  ChevronRightIcon,
  FolderIcon,
  MessagesSquareIcon,
  PlusIcon,
  PuzzleIcon,
} from 'lucide-react';
import { Fragment, useCallback, useMemo, useRef, useState } from 'react';
import { Link, useMatch, useNavigate } from 'react-router';
import { BrandToggle, Wordmark } from '@/components/brand-mark';
import { ThreadList } from '@/components/chat/thread-list';
import { useHarnessAgent } from '@/components/harness/harness-agent';
import { WorkspaceSection } from '@/components/workspace/workspace-section';
import { ariaShortcut, isMacPlatform, shortcutLabel } from '@/lib/shortcuts';
import { readPins, writePins } from '@/lib/threads';
import { cn } from '@/lib/utils';
import {
  GROUPS,
  HARNESS_DESTINATIONS,
  NavGlance,
  navSearch,
  useActiveRowInView,
  useActivityGlance,
  useDraftGlance,
  useNavGlances,
  walkNav,
} from '@/routes/harness';
import { useShell } from '@/shell-context';

/**
 * The app sidebar: every door this client has, in one place on both addresses.
 *
 * Top to bottom by how often each is the reason to open it — New chat, then the
 * threads (pinned, then by last activity), then the folder the agent works on,
 * then the harness's own pages — those last in debug mode only. Debug off, the
 * sidebar is the daily one: New chat, threads, workspace, and a Skill drafts row
 * that appears only while drafts wait on a review. It replaced three separate ways in: a threads
 * popover hung off the workspace header (the only door to another conversation,
 * at any width), the workspace zone itself, and `/harness`'s resident nav rail.
 *
 * Collapsed, it is a column of icons with their names in tooltips, and every
 * section is still one click away: Threads and Workspace expand the sidebar and
 * land where they point, and the harness destinations navigate directly. Below
 * 1024px it is a drawer instead (`use-rails`), closed on every load.
 */
export function AppSidebar() {
  const {
    threads,
    threadId,
    watching,
    selectThread,
    newThread,
    deleteThread,
    renameThread,
    forkThread,
    compactThread,
    exportThread,
    tenantApprovals,
    runningThreads,
    blockedThreads,
    debug,
  } = useShell();
  const { state, open, isMobile, setOpen, setOpenMobile, toggleSidebar } = useSidebar();
  const collapsed = state === 'collapsed' && !isMobile;
  const navigate = useNavigate();
  const onHarness = !!useMatch('/harness/*');
  const mac = isMacPlatform();

  /** A drawer has done its job once the operator picks somewhere to go. */
  const done = useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);

  const [pinned, setPinned] = useState<ReadonlySet<string>>(readPins);
  const togglePin = useCallback((id: string) => {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      writePins(next);
      return next;
    });
  }, []);

  /**
   * Threads waiting on a person: a pending approval from the shell's tenant-wide
   * poll, or a question an agent asked a run this tab carries — which
   * `/approvals` never lists, and which a run kept going in the background can
   * ask after the operator has moved on. The poll's last list stands through a
   * failed tick: an approval does not stop waiting because a request failed, and
   * the attention line is where the staleness is said.
   */
  const blocked = useMemo(() => {
    const ids = new Set<string>(blockedThreads);
    for (const a of tenantApprovals.pending) if (a.thread_id) ids.add(a.thread_id);
    return ids;
  }, [tenantApprovals.pending, blockedThreads]);

  /** Expand, then put the caret in the thread search — the collapsed icons' one job. */
  const openSearch = useCallback(() => {
    setOpen(true);
    requestAnimationFrame(() =>
      document.querySelector<HTMLElement>('[data-shortcut-target="thread-search"]')?.focus(),
    );
  }, [setOpen]);

  return (
    <Sidebar title="Navigation" sheetProps={{ 'data-shortcut-surface': 'workspace' }}>
      {/* The brand, at the sidebar's top edge and on the header's line: the same
          height, inset and rule, so the two read as one bar. The mark is the
          sidebar's toggle — the sidebar runs full height now, and the header no
          longer carries a panel button or a slot held empty for one.

          The mark sits 8px in, which is where the menu's icons sit, so collapsed
          to icons it heads their column; the wordmark beyond it is clipped by the
          panel's edge as it narrows rather than snapping out. Its first glyph
          starts 2px short of the collapsed rail's edge, though, so at rest it
          left a sliver beside the mark: it fades out over the last 75ms of the
          narrowing, and back in at once when the panel widens, so the clip is
          what is seen both ways. Opacity, not `invisible` or `sr-only`: it is
          the page's one `h1`, and it stays in the accessibility tree collapsed.
          Inline, the wordmark is the page's `h1`; in the drawer the header
          behind it already holds that, so it is a span here. */}
      <div
        data-slot="sidebar-brand"
        className="flex h-[calc(var(--header-height)+env(safe-area-inset-top,0px))] shrink-0 items-center gap-2 px-2.5 pt-safe lg:mt-2"
      >
        {isMobile ? (
          <BrandToggle
            open
            onClick={() => setOpenMobile(false)}
            aria-label="Close sidebar"
            title="Close sidebar"
          />
        ) : (
          <BrandToggle
            open={open}
            onClick={toggleSidebar}
            // The header's old toggle's name and state, kept: what a reader hears
            // and what the keyboard layer's tests find did not move with it.
            aria-label="Sidebar"
            aria-pressed={open}
            aria-keyshortcuts={ariaShortcut('toggle-workspace', mac)}
            title={`${open ? 'Collapse' : 'Expand'} sidebar (${shortcutLabel('toggle-workspace', mac)})`}
          />
        )}
        <Wordmark
          heading={!isMobile}
          className="transition-opacity duration-75 ease-out group-data-[collapsible=icon]:opacity-0 group-data-[collapsible=icon]:delay-[125ms] motion-reduce:transition-none"
        />
      </div>
      <SidebarHeader className="pb-1">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              tooltip="New chat"
              onClick={() => {
                newThread();
                done();
              }}
              className="rounded-full bg-primary font-semibold text-primary-foreground shadow-lift hover:bg-primary/90 hover:text-primary-foreground"
            >
              <PlusIcon aria-hidden />
              <span>New chat</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {collapsed && (
            <>
              <SidebarMenuItem>
                {/* One icon for the threads, landing in their search: a second,
                    "Search threads", did exactly the same thing. Marked when
                    something is waiting on a thread, so the collapsed column still
                    says there is a reason to open it. */}
                <SidebarMenuButton
                  tooltip={`Threads (${shortcutLabel('open-threads', mac)})`}
                  aria-keyshortcuts={ariaShortcut('open-threads', mac)}
                  onClick={openSearch}
                  className="relative"
                >
                  <MessagesSquareIcon aria-hidden />
                  <span>Threads</span>
                  {/* One dot, the most urgent state: something waiting on a person
                      before a run merely going. Said as well as drawn. */}
                  {(blocked.size > 0 || runningThreads.size > 0) && (
                    <span
                      aria-hidden
                      className={cn(
                        'absolute top-1.5 right-1.5 size-1.5 rounded-full',
                        blocked.size > 0 ? 'bg-state-blocked' : 'bg-state-running',
                      )}
                    />
                  )}
                  {blocked.size > 0 ? (
                    <span className="sr-only">, something is waiting on you on a thread</span>
                  ) : runningThreads.size > 0 ? (
                    <span className="sr-only">
                      , {runningThreads.size === 1 ? 'a run is' : `${runningThreads.size} runs are`}{' '}
                      going
                    </span>
                  ) : null}
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Workspace" onClick={() => setOpen(true)}>
                  <FolderIcon aria-hidden />
                  <span>Workspace</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </>
          )}
        </SidebarMenu>
      </SidebarHeader>

      {/* Expanded, the content does not scroll as a whole: the thread list takes
          the height the lower region leaves and scrolls its own rows, and the
          lower region — the workspace and the harness's pages — scrolls as one
          below it, capped at 40% of the viewport. When the sidebar scrolled too,
          a mounted folder's file tree put three scrollbars side by side and
          pushed the harness's pages off the bottom. */}
      <SidebarContent className={cn(!collapsed && 'overflow-y-hidden')}>
        {!collapsed && (
          <>
            <ThreadList
              threads={threads}
              currentId={onHarness ? '' : threadId}
              heldId={onHarness ? threadId : undefined}
              blocked={blocked}
              running={runningThreads}
              pinned={pinned}
              onTogglePin={togglePin}
              onSelect={(id) => {
                // On `/harness` the current thread is still the tab's thread, and
                // `selectThread` ignores it; picking it is a way back to it.
                if (id === threadId) navigate(`/t/${id}`);
                else selectThread(id);
                done();
              }}
              onDelete={deleteThread}
              onRename={renameThread}
              onFork={(id) => {
                forkThread(id);
                done();
              }}
              onCompact={compactThread}
              onExport={exportThread}
              readOnlyId={watching ? threadId : undefined}
            />
            <SidebarSeparator />
            {/* A fixed height, not a cap: the region's content changes with the
                address and the mode (two harness rows on a thread, nine on
                `/harness`), and a region sized to its content grew upward on
                arrival, moving the row just clicked out from under the pointer.

                The order follows the address. On `/harness` the destinations are
                the page's own navigation, so they lead and the workspace follows,
                folded there; on a thread the workspace is where its tools run, so
                it leads — except for debug off's few harness rows, which sit first
                in the same frame `/harness` draws, so arriving only adds rows below
                Activity. */}
            <div
              data-slot="sidebar-lower"
              className="flex h-[40svh] flex-col gap-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]"
            >
              {onHarness ? (
                <>
                  <HarnessGroup collapsed={false} onNavigate={done} />
                  <SidebarSeparator />
                  {/* Keyed: the thread side draws a section at the same index, and
                      React would keep its state — open — rather than start folded. */}
                  <WorkspaceSection key="on-harness" foldedByDefault />
                </>
              ) : debug ? (
                <>
                  <WorkspaceSection />
                  <SidebarSeparator />
                  <HarnessGroup collapsed={false} onNavigate={done} />
                </>
              ) : (
                <>
                  <DailyHarnessRows collapsed={false} onNavigate={done} />
                  <SidebarSeparator />
                  <WorkspaceSection />
                </>
              )}
            </div>
          </>
        )}
        {collapsed &&
          (debug || onHarness ? (
            <HarnessGroup collapsed onNavigate={done} />
          ) : (
            <DailyHarnessRows collapsed onNavigate={done} />
          ))}
      </SidebarContent>
    </Sidebar>
  );
}

const HARNESS_FOLD_KEY = 'felix.sidebar.harnessFolded';

function readFolded(): boolean {
  try {
    return localStorage.getItem(HARNESS_FOLD_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The harness's nine pages, in the runs `GROUPS` sorts them into. Its glances —
 * failing jobs, recent Activity failures — poll only while the rows are on
 * screen, so a folded section costs nothing.
 *
 * The heading is an `h2`, like Threads and Workspace beside it, so moving by
 * headings does not skip it. On `/harness` it does not fold: there the rows are
 * the page's own navigation, and a fold remembered from the conversation side
 * would arrive with no way to any other page.
 */
function HarnessGroup({ collapsed, onNavigate }: { collapsed: boolean; onNavigate: () => void }) {
  const [folded, setFolded] = useState(readFolded);
  const { search } = useHarnessAgent();
  const onHarness = !!useMatch('/harness/*');
  // Collapsed to icons, the rows are all there is to the sidebar, so they never fold.
  const shown = collapsed || onHarness || !folded;
  // Collapsed too: the icons are on screen, and a failure that vanishes when the
  // column narrows is an instrument that stops reading.
  const glance = useNavGlances(shown);
  const at = useMatch('/harness/:destination/*')?.params.destination;
  const nav = useRef<HTMLElement>(null);
  useActiveRowInView(nav, collapsed ? undefined : at);

  return (
    <SidebarGroup className="pt-1">
      {/* Not rendered while collapsed: the label is faded out there, and a fold
          button nobody can see was still a Tab stop. The rows can't fold then anyway. */}
      {!collapsed && onHarness && (
        <SidebarGroupLabel asChild>
          <h2>Harness</h2>
        </SidebarGroupLabel>
      )}
      {!collapsed && !onHarness && (
        <h2>
          <SidebarGroupLabel asChild>
            <button
              type="button"
              aria-expanded={shown}
              aria-controls="sidebar-harness"
              onClick={() =>
                setFolded((f) => {
                  try {
                    localStorage.setItem(HARNESS_FOLD_KEY, f ? '0' : '1');
                  } catch {
                    // Storage blocked: the fold lasts for this page.
                  }
                  return !f;
                })
              }
              className="w-full hover:text-foreground"
            >
              Harness
              <ChevronRightIcon
                aria-hidden
                className={cn(
                  'ml-auto transition-transform duration-200 ease-out motion-reduce:transition-none',
                  shown && 'rotate-90',
                )}
              />
            </button>
          </SidebarGroupLabel>
        </h2>
      )}
      <SidebarGroupContent id="sidebar-harness" hidden={!shown}>
        <nav ref={nav} aria-label="Harness" onKeyDown={walkNav}>
          {GROUPS.map(({ key, label }, gi) => (
            <Fragment key={key}>
              {gi > 0 && <SidebarSeparator className="my-1.5" />}
              {!collapsed && (
                <p
                  id={`sidebar-harness-${key}`}
                  className="px-2.5 pt-1 pb-0.5 text-xs font-medium text-muted-foreground"
                >
                  {label}
                </p>
              )}
              <SidebarMenu aria-labelledby={collapsed ? undefined : `sidebar-harness-${key}`}>
                {HARNESS_DESTINATIONS.filter((d) => d.group === key).map(
                  ({ path, label: name, icon: Icon }) => (
                    <SidebarMenuItem key={path}>
                      {/* Every row a Tab stop, as links are. Active is read off
                          the address, so the Chat address marks none of them. */}
                      <SidebarMenuButton
                        asChild
                        isActive={at === path}
                        tooltip={name}
                        className="relative text-muted-foreground"
                      >
                        <Link
                          to={{
                            pathname: `/harness/${path}`,
                            search: navSearch(path, search, glance[path]),
                          }}
                          onClick={onNavigate}
                          aria-current={at === path ? 'page' : undefined}
                        >
                          <Icon aria-hidden />
                          <span className="min-w-0 flex-1 truncate">{name}</span>
                          {collapsed ? (
                            <CollapsedGlance glance={glance[path]} />
                          ) : (
                            <NavGlance glance={glance[path]} />
                          )}
                        </Link>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ),
                )}
              </SidebarMenu>
            </Fragment>
          ))}
        </nav>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/**
 * Debug off, the harness pages the sidebar still points at. **Activity**, always:
 * it answers "what happened while I was away", which is the daily surface's
 * question as much as debug's, and it was reachable only through a mode the menu
 * describes as ids and instruments. **Skill drafts**, only while there is a
 * reason to go — drafts an agent wrote, waiting on a person's review. The other
 * seven stay debug's, and are listed here only while the operator is already on
 * `/harness` (see `AppSidebar`).
 *
 * A failed check keeps a count it already had (with its age); a check that never
 * answered draws nothing on these rows, because "unchecked" is a fact about the
 * harness, which is debug's to say.
 */
function DailyHarnessRows({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate: () => void;
}) {
  const { search } = useHarnessAgent();
  const activity = useActivityGlance();
  const drafts = useDraftGlance();
  const quiet = (g: typeof activity) => (g && g.tone !== 'unknown' ? g : undefined);
  const runs = [
    {
      key: 'happened' as const,
      rows: [
        {
          key: 'activity',
          label: 'Activity',
          icon: ActivityIcon,
          to: { pathname: '/harness/activity', search: navSearch('activity', search, activity) },
          glance: quiet(activity),
        },
      ],
    },
    ...(drafts?.tone === 'blocked'
      ? [
          {
            key: 'knows' as const,
            rows: [
              {
                key: 'skill-drafts',
                label: 'Skill drafts',
                icon: PuzzleIcon,
                to: { pathname: '/harness/skills', search: '' },
                glance: drafts,
              },
            ],
          },
        ]
      : []),
  ];
  // Drawn in `HarnessGroup`'s frame, row for row — the heading, each run's
  // label, the same menu rows — so that arriving on `/harness` inserts the other
  // destinations below Activity and moves nothing above it.
  return (
    <SidebarGroup data-slot="daily-harness" className="pt-1">
      {!collapsed && (
        <SidebarGroupLabel asChild>
          <h2>Harness</h2>
        </SidebarGroupLabel>
      )}
      {runs.map(({ key, rows }, ri) => (
        <Fragment key={key}>
          {ri > 0 && <SidebarSeparator className="my-1.5" />}
          {!collapsed && (
            <p
              id={`sidebar-daily-${key}`}
              className="px-2.5 pt-1 pb-0.5 text-xs font-medium text-muted-foreground"
            >
              {GROUPS.find((g) => g.key === key)?.label}
            </p>
          )}
          <SidebarMenu aria-labelledby={collapsed ? undefined : `sidebar-daily-${key}`}>
            {rows.map(({ key: rowKey, label, icon: Icon, to, glance }) => (
              <SidebarMenuItem key={rowKey} data-slot={rowKey}>
                <SidebarMenuButton
                  asChild
                  tooltip={label}
                  className="relative text-muted-foreground"
                >
                  <Link to={to} onClick={onNavigate}>
                    <Icon aria-hidden />
                    <span className="min-w-0 flex-1 truncate">{label}</span>
                    {collapsed ? (
                      <CollapsedGlance glance={glance} />
                    ) : (
                      <NavGlance glance={glance} />
                    )}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </Fragment>
      ))}
    </SidebarGroup>
  );
}

/**
 * A destination's glance when the column is icons: a dot on the icon when
 * something failed, and the glance's own sentence for a reader. Nothing for a
 * quiet one — a dot that is always there says nothing.
 */
function CollapsedGlance({ glance }: { glance: ReturnType<typeof useNavGlances>[string] }) {
  if (!glance || glance.tone === 'unknown') return null;
  return (
    <>
      <span
        aria-hidden
        className={cn(
          'absolute top-1.5 right-1.5 size-1.5 rounded-full',
          glance.tone === 'failed' ? 'bg-state-failed' : 'bg-state-blocked',
        )}
      />
      <span className="sr-only">, {glance.title}</span>
    </>
  );
}
