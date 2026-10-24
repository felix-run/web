import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
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
  type LucideIcon,
  MessagesSquareIcon,
  PlusIcon,
  PuzzleIcon,
} from 'lucide-react';
import { Fragment, memo, useCallback, useMemo, useRef, useState } from 'react';
import { Link, useMatch, useNavigate } from 'react-router';
import { BrandToggle, Wordmark } from '@/components/brand-mark';
import { ThreadList } from '@/components/chat/thread-list';
import { useHarnessAgent } from '@/components/harness/harness-agent';
import { NeedsYouBand, NeedsYouIcon } from '@/components/needs-you-band';
import { WorkspaceRow } from '@/components/workspace/workspace-section';
import { useRecentAudit } from '@/hooks/use-recent-audit';
import { glanceWindow, rowOutcomes, threadOutcomes } from '@/lib/harness-glances';
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
import { useShellPick } from '@/shell-context';

/**
 * The app sidebar: every door this client has, in one place on both addresses.
 *
 * Top to bottom: New chat; the **Needs-you band** — what is waiting on the
 * operator, failing jobs, and runs going (`NeedsYouBand`); the threads (pinned,
 * then by last activity); the harness's own pages, as chips (all ten in harness
 * view; everyday Activity, and Skill drafts while drafts wait on a review); and
 * the folder the agent works on. It replaced three separate ways in: a threads
 * popover hung off the workspace header (the only door to another conversation,
 * at any width), the workspace zone itself, and `/harness`'s resident nav rail.
 *
 * Collapsed, it is a column of icons with their names in tooltips, and every
 * section is still one click away: the band's icon, Threads and Workspace expand
 * the sidebar and land where they point, and the harness destinations navigate
 * directly. Below
 * 1024px it is a drawer instead (`use-rails`), closed on every load.
 */
export const AppSidebar = memo(function AppSidebar() {
  // Picked, not `useShell()`, and memoised: the shell renders on every streamed frame and
  // nothing here changes with a reply, so the sidebar — its thread list and every
  // tooltip in it — was ~40% of render time while one streamed.
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
  } = useShellPick(
    'threads',
    'threadId',
    'watching',
    'selectThread',
    'newThread',
    'deleteThread',
    'renameThread',
    'forkThread',
    'compactThread',
    'exportThread',
    'tenantApprovals',
    'runningThreads',
    'blockedThreads',
    'harnessView',
    'threadIndex',
  );
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
   * How each thread's newest turn ended when it failed or had a call denied,
   * from the audit read the Activity glance already polls — one request for the
   * glance, these marks and the Jobs page — and how far back that read reaches,
   * which the list says beside its heading. Off while the list is not drawn
   * (collapsed to icons).
   */
  const recentAudit = useRecentAudit(!collapsed);
  const { outcomes, outcomeSpan } = useMemo(() => {
    if (!recentAudit.data) return { outcomes: undefined, outcomeSpan: undefined };
    const now = Date.now();
    return {
      outcomes: rowOutcomes(threadOutcomes(recentAudit.data, now)),
      outcomeSpan: glanceWindow(recentAudit.data, now).span,
    };
  }, [recentAudit.data]);

  const harnessEntries = useHarnessEntries(harnessView, true);

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
              {/* The band, as one icon carrying its most urgent state: what used
                  to be a dot on Threads, now said by the thing that lists it. */}
              <NeedsYouIcon onOpen={() => setOpen(true)} />
              <SidebarMenuItem>
                {/* One icon for the threads, landing in their search: a second,
                    "Search threads", did exactly the same thing. */}
                <SidebarMenuButton
                  tooltip={`Threads (${shortcutLabel('open-threads', mac)})`}
                  aria-keyshortcuts={ariaShortcut('open-threads', mac)}
                  onClick={openSearch}
                >
                  <MessagesSquareIcon aria-hidden />
                  <span>Threads</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </>
          )}
        </SidebarMenu>
      </SidebarHeader>

      {/* Expanded, the content does not scroll as a whole: the Needs-you band
          holds its own rows above everything, the thread list takes the height
          the lower region leaves and scrolls its own rows, and the lower region
          — the harness's pages and the workspace — scrolls on its own below it.
          When the sidebar scrolled too, a mounted folder's file tree put three
          scrollbars side by side and pushed the harness's pages off the bottom. */}
      <SidebarContent className={cn(!collapsed && 'overflow-y-hidden')}>
        {!collapsed && (
          <>
            <NeedsYouBand onNavigate={done} />
            <ThreadList
              threads={threads}
              currentId={onHarness ? '' : threadId}
              heldId={onHarness ? threadId : undefined}
              blocked={blocked}
              running={runningThreads}
              outcomes={outcomes}
              outcomeSpan={outcomeSpan}
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
            {/* The threads come first. The region below them held the harness's
                pages as rows, ten in harness view at ~400px of a 941px window, and
                every sizing rule here since 2026-10-08 was a way to give the list
                its height back: a fixed clamp, a 35svh cap, a reservation so a fold
                never dropped the row under the pointer, folds per run. As chips
                (2026-10-24) the ten take four or five lines and nothing folds, so
                the region is its content. When the sidebar cannot hold everything
                it still gives way before the list (`shrink-[100]`), down to a floor
                that holds the ten chips whole on a laptop's height, a glance or two
                wrapping included (18rem, or 35svh
                on a shorter window), and scrolls under a fade below it; the list keeps its own floor (`min-h` on
                `ThreadList`'s section).

                Everyday the harness's rows are Activity, and Skill drafts while
                drafts wait, and the region reserves room for both, so a draft
                arriving moves nothing.

                One order, on every address and in both modes: Harness, then the
                workspace. It followed the address once, and the row clicked to
                arrive jumped 142px when the two swapped. The Workspace row sits
                outside the harness's scroll, so a scrolled region still shows it
                and the fade never covers it. The workspace is one row; its trees
                are the side pane's Files tab. */}
            <div
              data-slot="sidebar-lower"
              className={cn(
                'flex shrink-[100]! flex-col',
                harnessView && 'min-h-[min(35svh,18rem)]',
              )}
            >
              <div
                data-slot="sidebar-lower-scroll"
                className={cn(
                  'min-h-0 flex-1 scroll-fade-b overflow-y-auto overscroll-contain [scrollbar-gutter:stable]',
                  !harnessView && 'min-h-[6rem]',
                )}
              >
                <HarnessChips entries={harnessEntries} asNav={harnessView} onNavigate={done} />
              </div>
              <div className="shrink-0 border-t border-border/60 empty:hidden">
                <WorkspaceRow collapsed={false} onNavigate={done} />
              </div>
            </div>
          </>
        )}
        {collapsed && (
          <>
            <HarnessIcons entries={harnessEntries} asNav={harnessView} onNavigate={done} />
            <WorkspaceRow collapsed onNavigate={done} />
          </>
        )}
      </SidebarContent>
    </Sidebar>
  );
});

type GroupKey = (typeof GROUPS)[number]['key'];
type Glance = ReturnType<typeof useNavGlances>[string];

/** One harness page the sidebar points at, with what its glance says. */
interface HarnessEntry {
  key: string;
  label: string;
  icon: LucideIcon;
  group: GroupKey;
  to: { pathname: string; search: string };
  active: boolean;
  glance: Glance;
}

/**
 * The harness pages this view points at. In harness view, all ten with their
 * glances — failing jobs, recent Activity failures, drafts waiting — which poll
 * only while drawn. Everyday, **Activity**, always: it answers "what happened
 * while I was away", which is the daily surface's question as much as harness
 * view's; and **Skill drafts**, only while drafts an agent wrote wait on a
 * person's review (or while the reader is on Skills, so publishing the last one
 * does not take the row they are on out of the sidebar). Everyday, a check that
 * never answered draws nothing, because "unchecked" is a fact about the harness,
 * which is harness view's to say; a failed check keeps a count it had, with its age.
 */
function useHarnessEntries(harnessView: boolean, enabled: boolean): HarnessEntry[] {
  const { search } = useHarnessAgent();
  const glance = useNavGlances(enabled && harnessView);
  const activity = useActivityGlance(enabled && !harnessView);
  const drafts = useDraftGlance(enabled && !harnessView);
  const at = useMatch('/harness/:destination/*')?.params.destination;
  if (harnessView) {
    return HARNESS_DESTINATIONS.map((d) => ({
      key: d.path,
      label: d.label,
      icon: d.icon,
      group: d.group,
      to: {
        pathname: `/harness/${d.path}`,
        search: navSearch(d.path, search, glance[d.path]),
      },
      active: at === d.path,
      glance: glance[d.path],
    }));
  }
  const quiet = (g: Glance) => (g && g.tone !== 'unknown' ? g : undefined);
  const entries: HarnessEntry[] = [
    {
      key: 'activity',
      label: 'Activity',
      icon: ActivityIcon,
      group: 'happened',
      to: { pathname: '/harness/activity', search: navSearch('activity', search, quiet(activity)) },
      active: at === 'activity',
      glance: quiet(activity),
    },
  ];
  if (drafts?.tone === 'blocked' || at === 'skills') {
    entries.push({
      key: 'skill-drafts',
      label: 'Skill drafts',
      icon: PuzzleIcon,
      group: 'knows',
      to: { pathname: '/harness/skills', search: '' },
      active: at === 'skills',
      glance: drafts?.tone === 'blocked' ? drafts : undefined,
    });
  }
  return entries;
}

/** `entries` in `GROUPS`' order, a run per group that has any. */
function runsOf(entries: HarnessEntry[]) {
  return GROUPS.map((g) => ({ ...g, entries: entries.filter((e) => e.group === g.key) })).filter(
    (g) => g.entries.length > 0,
  );
}

/**
 * The harness's pages, expanded: **chips** that wrap, a run per question —
 * *What happened*, *What it knows*, *How it's set up* — told apart by a hairline
 * rather than a label (2026-10-24). As rows with a label per run they took ~400px
 * of a 941px window in harness view, which is why each run folded and *How it's
 * set up* started folded; as chips the ten take four or five lines, so nothing
 * folds and nothing is ever out of reach behind a fold. Each run is still a named
 * list for a reader.
 *
 * A glance is a dot and its words on the chip (`1 failing`), never the dot alone.
 * On `/harness` these are the page's own navigation: the current page's chip is
 * lifted, as a selected row is, and kept in view.
 */
function HarnessChips({
  entries,
  asNav,
  onNavigate,
}: {
  entries: HarnessEntry[];
  /**
   * Harness view: the pages are the harness's navigation, a `nav` the arrows
   * walk. Everyday it is a door or two, a list under the heading — the harness
   * as a console is harness view's.
   */
  asNav: boolean;
  onNavigate: () => void;
}) {
  const nav = useRef<HTMLDivElement>(null);
  useActiveRowInView(nav, entries.find((e) => e.active)?.key);
  const Frame = asNav ? 'nav' : 'div';
  return (
    <SidebarGroup data-slot={asNav ? 'harness-pages' : 'daily-harness'} className="pt-1">
      <SidebarGroupLabel asChild className="text-foreground">
        <h2>Harness</h2>
      </SidebarGroupLabel>
      <Frame
        ref={nav}
        aria-label={asNav ? 'Harness' : undefined}
        onKeyDown={asNav ? walkNav : undefined}
      >
        {runsOf(entries).map((run, i) => (
          <Fragment key={run.key}>
            {i > 0 && <SidebarSeparator className="mx-2.5 my-1.5" />}
            <ul aria-label={run.label} className="flex flex-wrap gap-1">
              {run.entries.map((e) => (
                <li key={e.key} data-slot={e.key}>
                  <Link
                    to={e.to}
                    onClick={onNavigate}
                    aria-current={e.active ? 'page' : undefined}
                    data-active={e.active || undefined}
                    className={cn(
                      'inline-flex h-8 coarse:h-10 max-w-full items-center gap-1.5 rounded-lg px-2.5 text-sm text-muted-foreground outline-none',
                      'hover:bg-[color-mix(in_oklab,var(--sidebar-accent)_70%,var(--ground))] hover:text-foreground',
                      'focus-visible:ring-[3px] focus-visible:ring-ring',
                      'data-active:bg-sidebar-accent data-active:font-semibold data-active:text-foreground data-active:shadow-sheet',
                    )}
                  >
                    <span className="shrink-0">{e.label}</span>
                    {e.glance && <ChipGlance glance={e.glance} />}
                  </Link>
                </li>
              ))}
            </ul>
          </Fragment>
        ))}
      </Frame>
    </SidebarGroup>
  );
}

/** A chip's glance: the state's dot and its words, the way `NavGlance` says them on a row. */
function ChipGlance({ glance }: { glance: NonNullable<Glance> }) {
  return (
    <span className="flex min-w-0 items-center gap-1 text-xs font-medium">
      {glance.tone !== 'unknown' && (
        <span
          aria-hidden
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            glance.tone === 'failed' ? 'bg-state-failed' : 'bg-state-blocked',
          )}
        />
      )}
      <NavGlance glance={glance} />
    </span>
  );
}

/**
 * The harness's pages collapsed to the icon column: a run per question, a rule
 * between runs, each icon named in its tooltip. Every row a Tab stop, as links are.
 */
function HarnessIcons({
  entries,
  asNav,
  onNavigate,
}: {
  entries: HarnessEntry[];
  asNav: boolean;
  onNavigate: () => void;
}) {
  const Frame = asNav ? 'nav' : 'div';
  return (
    <SidebarGroup className="pt-1">
      <Frame aria-label={asNav ? 'Harness' : undefined} onKeyDown={asNav ? walkNav : undefined}>
        {runsOf(entries).map((run, i) => (
          <Fragment key={run.key}>
            {i > 0 && <SidebarSeparator className="my-1.5" />}
            <SidebarMenu aria-label={run.label}>
              {run.entries.map(({ key, label, icon: Icon, to, active, glance }) => (
                <SidebarMenuItem key={key} data-slot={key}>
                  <SidebarMenuButton
                    asChild
                    isActive={active}
                    tooltip={label}
                    className="relative text-muted-foreground"
                  >
                    <Link to={to} onClick={onNavigate} aria-current={active ? 'page' : undefined}>
                      <Icon aria-hidden />
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                      <CollapsedGlance glance={glance} />
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </Fragment>
        ))}
      </Frame>
    </SidebarGroup>
  );
}

/**
 * A destination's glance when the column is icons: a dot on the icon when
 * something failed or waits, and the glance's own sentence for a reader. Nothing
 * for a quiet one — a dot that is always there says nothing.
 */
function CollapsedGlance({ glance }: { glance: Glance }) {
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
