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
  MessagesSquareIcon,
  PlusIcon,
  PuzzleIcon,
} from 'lucide-react';
import { Fragment, useCallback, useMemo, useRef, useState } from 'react';
import { Link, useMatch, useNavigate } from 'react-router';
import { BrandToggle, Wordmark } from '@/components/brand-mark';
import { ThreadList } from '@/components/chat/thread-list';
import { useHarnessAgent } from '@/components/harness/harness-agent';
import { WorkspaceRow } from '@/components/workspace/workspace-section';
import { useRecentAudit } from '@/hooks/use-recent-audit';
import { failedThreads, threadOutcomes } from '@/lib/harness-glances';
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
 * then the harness's own pages — those last in harness view only. Everyday, the
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
    harnessView,
    threadIndex,
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

  /**
   * Threads whose newest turn failed, from the audit read the Activity glance
   * already polls — one request for the glance, these marks and the Jobs page.
   * Off while the list is not drawn (collapsed to icons).
   */
  const recentAudit = useRecentAudit(!collapsed);
  const failed = useMemo(
    () => failedThreads(threadOutcomes(recentAudit.data ?? [], Date.now())),
    [recentAudit.data],
  );

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
          )}
        </SidebarMenu>
      </SidebarHeader>

      {/* Expanded, the content does not scroll as a whole: the thread list takes
          the height the lower region leaves and scrolls its own rows, and the
          lower region — the workspace and the harness's pages — scrolls as one
          below it, capped at 35% of the viewport. When the sidebar scrolled too,
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
              failed={failed}
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
              indexStatus={threadIndex}
            />
            <SidebarSeparator />
            {/* The threads come first. Harness view held this region at a fixed
                `clamp(40svh,32.5rem,60svh)` — 520px of a 997px window — which left
                the thread list four rows and scrolled the Workspace row out of
                sight below the ten destinations. Since 2026-10-16 it is sized by
                its content and capped at 35svh, scrolling inside itself past that,
                and *How it's set up* starts folded (`HarnessGroup`).

                Why that does not bring back the jump that made it fixed: the
                region once sized to rows that changed **with the address** (two
                harness rows on a thread, ten on `/harness`), so it grew upward on
                arrival and moved the row just clicked. In harness view the rows no
                longer depend on the address — the same groups are drawn on every
                page, and arriving at a page in a folded group unfolds it *and
                leaves it unfolded*, so leaving that page never shrinks the region.
                What remains is the operator's own fold, and `min-h` covers that:
                it reserves the default layout's height (both open groups, the
                folded one's label, Workspace — 25.5rem measured at 1456×997), so
                folding the whole group leaves the rows where they were rather than
                dropping the heading the pointer is on. Under ~1170px tall the cap
                is below the reservation and the region is simply 35svh on every
                address and fold. Unfolding *How it's set up* on a taller window
                grows it once, by at most the difference.

                One order, on every address and in both modes: Harness, then the
                workspace. It followed the address once, and the row clicked to
                arrive jumped 142px when the two swapped. The Workspace row sticks
                to the region's bottom edge, so a scrolled region still shows it.
                The workspace is one row; its trees are the side pane's Files tab. */}
            <div
              data-slot="sidebar-lower"
              className={cn(
                'flex shrink-0 flex-col gap-1 overflow-y-auto overscroll-contain [scrollbar-gutter:stable]',
                // Everyday the rows are three at most — Activity, Skill drafts
                // while drafts wait, Workspace — so the region is sized for all
                // three and fixed, so nothing moves when drafts come and go.
                harnessView ? 'max-h-[35svh] min-h-[min(35svh,25.5rem)]' : 'h-[min(40svh,13rem)]',
              )}
            >
              {harnessView ? (
                <HarnessGroup collapsed={false} onNavigate={done} />
              ) : (
                <DailyHarnessRows collapsed={false} onNavigate={done} />
              )}
              <div className="sticky bottom-0 z-10 mt-auto border-t border-border/60 bg-ground empty:hidden">
                <WorkspaceRow collapsed={false} onNavigate={done} />
              </div>
            </div>
          </>
        )}
        {collapsed && (
          <>
            {harnessView ? (
              <HarnessGroup collapsed onNavigate={done} />
            ) : (
              <DailyHarnessRows collapsed onNavigate={done} />
            )}
            <WorkspaceRow collapsed onNavigate={done} />
          </>
        )}
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

type GroupKey = (typeof GROUPS)[number]['key'];

/** Each run's own fold, as the operator last left it; a run never chosen is absent. */
const GROUP_FOLD_KEY = 'felix.sidebar.harnessGroups';

/**
 * Folded until someone opens it: *How it's set up* is visited when something is
 * being configured, not on the way back to a conversation, and its four rows were
 * what pushed the thread list down to four.
 */
export const GROUP_FOLDED_BY_DEFAULT: Readonly<Record<GroupKey, boolean>> = {
  happened: false,
  knows: false,
  setup: true,
};

function readGroupFolds(): Record<GroupKey, boolean> {
  const folds = { ...GROUP_FOLDED_BY_DEFAULT };
  try {
    const stored = JSON.parse(localStorage.getItem(GROUP_FOLD_KEY) ?? '{}') as unknown;
    if (stored && typeof stored === 'object') {
      for (const { key } of GROUPS) {
        const v = (stored as Record<string, unknown>)[key];
        if (typeof v === 'boolean') folds[key] = v;
      }
    }
  } catch {
    // Unreadable or blocked: the defaults.
  }
  return folds;
}

function writeGroupFold(key: GroupKey, folded: boolean) {
  try {
    const stored = JSON.parse(localStorage.getItem(GROUP_FOLD_KEY) ?? '{}') as Record<
      string,
      unknown
    >;
    localStorage.setItem(GROUP_FOLD_KEY, JSON.stringify({ ...stored, [key]: folded }));
  } catch {
    // Storage blocked: the fold lasts for this page.
  }
}

/**
 * The harness's ten pages, in the runs `GROUPS` sorts them into. Its glances —
 * failing jobs, recent Activity failures — poll only while the rows are on
 * screen, so a folded section costs nothing.
 *
 * The heading is an `h2`, like Threads and Workspace beside it, so moving by
 * headings does not skip it. On `/harness` it does not fold: there the rows are
 * the page's own navigation, and a fold remembered from the conversation side
 * would arrive with no way to any other page.
 *
 * Each run folds on its own too (`GROUP_FOLDED_BY_DEFAULT`), and the same rule
 * holds one level down: the run holding the page on screen is always open, and
 * its toggle is off while it is. Arriving on a page in a folded run unfolds it
 * for the rest of the visit rather than only while the page is current — so
 * leaving the page never folds rows back up under the pointer that left it.
 */
function HarnessGroup({ collapsed, onNavigate }: { collapsed: boolean; onNavigate: () => void }) {
  const [folded, setFolded] = useState(readFolded);
  const [groupFolds, setGroupFolds] = useState(readGroupFolds);
  const { search } = useHarnessAgent();
  const onHarness = !!useMatch('/harness/*');
  // Collapsed to icons, the rows are all there is to the sidebar, so they never fold.
  const shown = collapsed || onHarness || !folded;
  // Collapsed too: the icons are on screen, and a failure that vanishes when the
  // column narrows is an instrument that stops reading.
  const glance = useNavGlances(shown);
  const at = useMatch('/harness/:destination/*')?.params.destination;
  const atGroup = HARNESS_DESTINATIONS.find((d) => d.path === at)?.group;
  // Not written to storage: a remembered fold is the operator's, and an arrival
  // is not them choosing to keep the run open next time.
  if (atGroup && groupFolds[atGroup]) setGroupFolds((f) => ({ ...f, [atGroup]: false }));
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
          {GROUPS.map(({ key, label }, gi) => {
            const pinned = atGroup === key;
            const open = collapsed || pinned || !groupFolds[key];
            return (
              <Fragment key={key}>
                {gi > 0 && <SidebarSeparator className="my-1.5" />}
                {!collapsed && (
                  <h3
                    id={`sidebar-harness-${key}`}
                    className="text-xs font-medium text-muted-foreground"
                  >
                    {/* The run's name is its toggle, as Harness's is: one row the
                        same height folded or open, pinned or not. Disabled while
                        the page on screen is in it, never hidden — the label is
                        what names its list. */}
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-controls={`sidebar-harness-${key}-rows`}
                      disabled={pinned}
                      title={pinned ? 'The page you are on is in this group' : undefined}
                      onClick={() => {
                        const next = !groupFolds[key];
                        writeGroupFold(key, next);
                        setGroupFolds((f) => ({ ...f, [key]: next }));
                      }}
                      className="flex w-full items-center rounded-md px-2.5 pt-1 pb-0.5 text-left outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring disabled:hover:text-muted-foreground"
                    >
                      {label}
                      <ChevronRightIcon
                        aria-hidden
                        className={cn(
                          'ml-auto size-3.5 transition-transform duration-200 ease-out motion-reduce:transition-none',
                          open && 'rotate-90',
                          pinned && 'opacity-0',
                        )}
                      />
                    </button>
                  </h3>
                )}
                <SidebarMenu
                  id={`sidebar-harness-${key}-rows`}
                  hidden={!open}
                  aria-labelledby={collapsed ? undefined : `sidebar-harness-${key}`}
                >
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
            );
          })}
        </nav>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/**
 * Everyday, the harness pages the sidebar still points at. **Activity**, always:
 * it answers "what happened while I was away", which is the daily surface's
 * question as much as harness view's. **Skill drafts**, only while there is a
 * reason to go — drafts an agent wrote, waiting on a person's review. The other
 * seven are harness view's, on `/harness` too: everyday, the harness is Activity
 * (and a review queue when one waits), not a console.
 *
 * A failed check keeps a count it already had (with its age); a check that never
 * answered draws nothing on these rows, because "unchecked" is a fact about the
 * harness, which is harness view's to say.
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
  const atActivity = !!useMatch('/harness/activity/*');
  const atSkills = !!useMatch('/harness/skills/*');
  const runs = [
    {
      key: 'happened' as const,
      rows: [
        {
          key: 'activity',
          label: 'Activity',
          icon: ActivityIcon,
          to: { pathname: '/harness/activity', search: navSearch('activity', search, activity) },
          active: atActivity,
          glance: quiet(activity),
        },
      ],
    },
    // Kept while the reader is on the skills page: publishing the last draft
    // would otherwise take the row they are on out of the sidebar.
    ...(drafts?.tone === 'blocked' || atSkills
      ? [
          {
            key: 'knows' as const,
            rows: [
              {
                key: 'skill-drafts',
                label: 'Skill drafts',
                icon: PuzzleIcon,
                to: { pathname: '/harness/skills', search: '' },
                active: atSkills,
                glance: drafts?.tone === 'blocked' ? drafts : undefined,
              },
            ],
          },
        ]
      : []),
  ];
  // Drawn in `HarnessGroup`'s frame, row for row — the heading, each run's
  // label, the same menu rows — so harness view adds the other destinations
  // below Activity and moves nothing above it.
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
            {rows.map(({ key: rowKey, label, icon: Icon, to, active, glance }) => (
              <SidebarMenuItem key={rowKey} data-slot={rowKey}>
                <SidebarMenuButton
                  asChild
                  isActive={active}
                  tooltip={label}
                  className="relative text-muted-foreground"
                >
                  <Link to={to} onClick={onNavigate} aria-current={active ? 'page' : undefined}>
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
