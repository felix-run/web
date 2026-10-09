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
import { ChevronRightIcon, FolderIcon, MessagesSquareIcon, PlusIcon } from 'lucide-react';
import { Fragment, useCallback, useMemo, useState } from 'react';
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
  useNavGlances,
  walkNav,
} from '@/routes/harness';
import { useShell } from '@/shell-context';

/**
 * The app sidebar: every door this client has, in one place on both addresses.
 *
 * Top to bottom by how often each is the reason to open it — New chat, then the
 * threads (pinned, then by last activity), then the folder the agent works on,
 * then the harness's own pages. It replaced three separate ways in: a threads
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
          panel's edge as it narrows rather than snapping out. Inline, the wordmark
          is the page's `h1`; in the drawer the header behind it already holds
          that, so it is a span here. */}
      <div
        data-slot="sidebar-brand"
        className="flex h-[calc(var(--header-height)+env(safe-area-inset-top,0px))] shrink-0 items-center gap-2 border-b border-border/60 px-2 pt-safe"
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
        <Wordmark heading={!isMobile} />
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
              className="border border-border/60 font-medium"
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
            <div
              data-slot="sidebar-lower"
              className="flex max-h-[40svh] flex-col gap-1 overflow-y-auto overscroll-contain"
            >
              <WorkspaceSection />
              <SidebarSeparator />
              <HarnessGroup collapsed={false} onNavigate={done} />
            </div>
          </>
        )}
        {collapsed && <HarnessGroup collapsed onNavigate={done} />}
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
 * The harness's eight pages, in the two runs `/harness` has always sorted them
 * into. Its glances — failing jobs, recent Activity failures — poll only while the
 * rows are on screen, so a folded section costs nothing.
 */
function HarnessGroup({ collapsed, onNavigate }: { collapsed: boolean; onNavigate: () => void }) {
  const [folded, setFolded] = useState(readFolded);
  const { search } = useHarnessAgent();
  // Collapsed to icons, the rows are all there is to the sidebar, so they never fold.
  const shown = collapsed || !folded;
  // Collapsed too: the icons are on screen, and a failure that vanishes when the
  // column narrows is an instrument that stops reading.
  const glance = useNavGlances(shown);
  const at = useMatch('/harness/:destination/*')?.params.destination;

  return (
    <SidebarGroup className="pt-1">
      {/* Not rendered while collapsed: the label is faded out there, and a fold
          button nobody can see was still a Tab stop. The rows can't fold then anyway. */}
      {!collapsed && (
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
      )}
      <SidebarGroupContent id="sidebar-harness" hidden={!shown}>
        <nav aria-label="Harness" onKeyDown={walkNav}>
          {GROUPS.map(({ key, label }, gi) => (
            <Fragment key={key}>
              {gi > 0 && <SidebarSeparator className="my-1.5" />}
              {!collapsed && (
                <p
                  id={`sidebar-harness-${key}`}
                  className="px-2 pt-1 pb-0.5 text-xs text-muted-foreground"
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
 * A destination's glance when the column is icons: a dot on the icon when
 * something failed, and the glance's own sentence for a reader. Nothing for a
 * quiet one — a dot that is always there says nothing.
 */
function CollapsedGlance({ glance }: { glance: ReturnType<typeof useNavGlances>[string] }) {
  if (!glance || glance.tone !== 'failed') return null;
  return (
    <>
      <span
        aria-hidden
        className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-state-failed"
      />
      <span className="sr-only">, {glance.title}</span>
    </>
  );
}
