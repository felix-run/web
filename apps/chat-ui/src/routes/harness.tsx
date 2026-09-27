import { Tabs, TabsContent, TabsList, TabsTrigger } from '@felix/ui/tabs';
import {
  ActivityIcon,
  BookOpenIcon,
  BotIcon,
  BrainIcon,
  ClockIcon,
  FlaskConicalIcon,
  GitBranchIcon,
  type LucideIcon,
  SparklesIcon,
} from 'lucide-react';
import { Fragment, type KeyboardEvent, useEffect, useMemo, useState } from 'react';
import { Navigate, NavLink, Outlet, useMatch, useSearchParams } from 'react-router';
import { getResolvedManifest } from '@/api';
import { AgentSheet } from '@/components/agent/agent-sheet';
import { EvalSheet } from '@/components/eval/eval-sheet';
import { DocumentsSection } from '@/components/harness/corpus';
import { HarnessAgentPicker, keepAgent, useHarnessAgent } from '@/components/harness/harness-agent';
import { ActivitySection, UsageSection } from '@/components/harness/ledger';
import { MemorySection } from '@/components/harness/memory';
import { PageBack, PageHeader, Panel } from '@/components/harness/panel';
import { SkillsSection } from '@/components/harness/skills';
import {
  PanelModeProvider,
  type SectionMeta,
  SectionMetaSink,
} from '@/components/inspector/primitives';
import { JobsSheet } from '@/components/jobs/jobs-sheet';
import { ManifestsSheet } from '@/components/manifests/manifests-sheet';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { setPresencePlace } from '@/lib/presence';
import { threadLabel } from '@/lib/threads';
import { cn } from '@/lib/utils';
import { useShell } from '@/shell-context';

/**
 * The harness: everything the tenant owns, at the lifetime it actually has.
 *
 * The inspector's eight sections divided by *lifetime*, not by topic. Three of
 * them describe the run on screen and stayed beside the transcript; the other
 * five outlive every run — what the agent has learned, what it retrieves from,
 * what it can do, what it did and what that cost. Those belong to the tenant, and
 * they were being read in a 22rem rail beside a conversation they had nothing to
 * do with.
 *
 * The four workbenches join them for the opposite reason: they were never hard to
 * find, they had no home. An ellipsis menu is where a surface goes when nobody has
 * decided what it is.
 */

/** A section rendered as a page rather than as an inspector row. */
function AsPanel({ children }: { children: React.ReactNode }) {
  return <PanelModeProvider>{children}</PanelModeProvider>;
}

function MemoryPanel() {
  return (
    <AsPanel>
      <MemorySection enabled open onToggle={() => {}} />
    </AsPanel>
  );
}

function CorpusPanel() {
  return (
    <AsPanel>
      <DocumentsSection enabled open onToggle={() => {}} />
    </AsPanel>
  );
}

function SkillsPanel() {
  const { skills, threads, threadId } = useShell();
  const { agent, isChatAgent } = useHarnessAgent();
  // What the manifest declares, so the page has something true to show before
  // the agent has been asked. One read per visit — the spec does not change
  // under a page that is open.
  const [specSkills, setSpecSkills] = useState<string[] | undefined>(undefined);
  useEffect(() => {
    let live = true;
    setSpecSkills(undefined);
    getResolvedManifest(agent)
      .then((r) => {
        const declared = (r.manifest as { spec?: { skills?: unknown[] } } | undefined)?.spec
          ?.skills;
        if (!live || !Array.isArray(declared)) return;
        setSpecSkills(
          declared.map((sk) =>
            typeof sk === 'string' ? sk : ((sk as { name?: string })?.name ?? String(sk)),
          ),
        );
      })
      // A failed read leaves the page saying what is unknown. Not worth an
      // error slab of its own.
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [agent]);
  // The conversation the active list came from, named the way the thread list
  // names it — a link to it, rather than a button that wrote into it from here.
  const thread = useMemo(() => {
    const meta = threads.find((t) => t.id === threadId);
    return meta ? threadLabel(meta) : { text: threadId, isId: true };
  }, [threads, threadId]);
  return (
    <AsPanel>
      <SkillsSection
        open
        onToggle={() => {}}
        // A thread's `list_skills` describes the chat's agent. Shown for another
        // one it would be an answer to a question nobody asked about it.
        skills={isChatAgent ? skills : null}
        specSkills={specSkills}
        agent={agent}
        thread={{ ...thread, to: `/t/${threadId}` }}
        isChatAgent={isChatAgent}
      />
    </AsPanel>
  );
}

/**
 * The Ledger: what the harness did, and what it cost.
 *
 * One destination, two halves, and only the visible half polls — which is the
 * whole reason this is segmented rather than stacked. An audit event and a usage
 * row are different shapes answering different questions, so a merged feed would
 * serve neither; but they are the same *question* — what has this tenant been
 * doing — so they are one place.
 */
function LedgerPanel() {
  // In the address, not in state: a half kept in `useState` could not be linked
  // to and reset to Activity on every visit, so "the Usage page" was two clicks
  // away from every link that meant it. `replace`, because switching halves is a
  // view change rather than a place Back should step through.
  const [params, setParams] = useSearchParams();
  const half: 'activity' | 'usage' = params.get('view') === 'usage' ? 'usage' : 'activity';
  const setHalf = (next: 'activity' | 'usage') =>
    setParams(keepAgent(params, next === 'usage' ? { view: 'usage' } : {}), { replace: true });
  // The visible half's header value, reported up by its `bare` section. Only the
  // visible half is mounted, so only it reports — the header describes the half
  // being read, from the one poll already running.
  const [meta, setMeta] = useState<SectionMeta>({ meta: undefined, metaTone: undefined });
  return (
    <Panel>
      {/*
        `@felix/ui/tabs` rather than hand-rolled roles: a `role="tablist"` with no
        `tabpanel`, no `aria-controls` and no arrow-key roving focus announces a
        widget that does not behave like one.
      */}
      <Tabs
        value={half}
        onValueChange={(v) => setHalf(v as 'activity' | 'usage')}
        className="min-h-0 flex-1 gap-0"
      >
        <PageHeader
          icon={<ActivityIcon />}
          title="Ledger"
          value={meta.meta}
          valueLead={meta.metaLead}
          valueTone={meta.metaTone}
          controls={
            // Held to the header's row height, so the Ledger's rule sits where
            // every other page's does.
            <TabsList
              aria-label="Ledger view"
              className="w-auto group-data-[orientation=horizontal]/tabs:h-8"
            >
              <TabsTrigger value="activity" className="px-2.5 text-xs">
                Activity
              </TabsTrigger>
              <TabsTrigger value="usage" className="px-2.5 text-xs">
                Usage
              </TabsTrigger>
            </TabsList>
          }
        />
        <SectionMetaSink.Provider value={setMeta}>
          <PanelModeProvider chrome="bare">
            <TabsContent value="activity" className="min-h-0 overflow-y-auto p-4">
              <ActivitySection enabled open onToggle={() => {}} />
            </TabsContent>
            <TabsContent value="usage" className="min-h-0 overflow-y-auto p-4">
              <UsageSection enabled open onToggle={() => {}} />
            </TabsContent>
          </PanelModeProvider>
        </SectionMetaSink.Provider>
      </Tabs>
    </Panel>
  );
}

function ManifestsPanel() {
  const { refreshCanary } = useShell();
  const { agent } = useHarnessAgent();
  // The header badge reports the rollout this panel can change, so leaving is
  // what re-reads it. As a sheet this hung off `onOpenChange`; the route
  // equivalent of closing is unmounting.
  useEffect(() => refreshCanary, [refreshCanary]);
  return <ManifestsSheet manifest={agent} />;
}

function JobsPanel() {
  const { manifestOptions } = useShell();
  const { agent } = useHarnessAgent();
  return <JobsSheet manifest={agent} manifestOptions={manifestOptions} />;
}

function EvalPanel() {
  const { manifestOptions } = useShell();
  const { agent } = useHarnessAgent();
  return <EvalSheet manifest={agent} manifestOptions={manifestOptions} />;
}

function AgentPanel() {
  const { agent } = useHarnessAgent();
  return <AgentSheet manifest={agent} />;
}

/**
 * The eight destinations, declared once.
 *
 * The nav and the route table are built from this same list, because a nav entry
 * with no route is a dead link and a route with no nav entry is a page nobody can
 * reach — and both of those are silent.
 *
 * `group` is the split this file's own header describes and the nav used to
 * hide: *records*, read far more often than changed — including Agent, which
 * reads the resolved spec and changes nothing — and *workbenches*, where the
 * operator changes what the next run does. Eight equal rows made the reader sort
 * them on every visit; two labelled runs have already been sorted.
 */
export const HARNESS_DESTINATIONS: {
  path: string;
  label: string;
  icon: LucideIcon;
  group: 'records' | 'workbenches';
  element: React.ReactNode;
}[] = [
  { path: 'memory', label: 'Memory', icon: BrainIcon, group: 'records', element: <MemoryPanel /> },
  {
    path: 'corpus',
    label: 'Corpus',
    icon: BookOpenIcon,
    group: 'records',
    element: <CorpusPanel />,
  },
  {
    path: 'skills',
    label: 'Skills',
    icon: SparklesIcon,
    group: 'records',
    element: <SkillsPanel />,
  },
  {
    path: 'ledger',
    label: 'Ledger',
    icon: ActivityIcon,
    group: 'records',
    element: <LedgerPanel />,
  },
  // A record, not a workbench: it reads the resolved spec and changes nothing.
  { path: 'agent', label: 'Agent', icon: BotIcon, group: 'records', element: <AgentPanel /> },
  {
    path: 'manifests',
    label: 'Manifests',
    icon: GitBranchIcon,
    group: 'workbenches',
    element: <ManifestsPanel />,
  },
  { path: 'jobs', label: 'Jobs', icon: ClockIcon, group: 'workbenches', element: <JobsPanel /> },
  {
    path: 'eval',
    label: 'Eval',
    icon: FlaskConicalIcon,
    group: 'workbenches',
    element: <EvalPanel />,
  },
];

const GROUPS = [
  { key: 'records', label: 'Records' },
  { key: 'workbenches', label: 'Workbenches' },
] as const;

/**
 * Up and down move between the nav's links, Home and End to either end.
 *
 * No global destination keys: every free `Mod+<key>` is already spent
 * (`lib/shortcuts.ts` says which and why), and a bare letter would type into
 * Memory's search box. What an operator can have is a list that behaves like
 * one once it has focus — Tab reaches it, the arrows walk it — rather than eight
 * separate tab stops between them and the page.
 */
function walkNav(event: KeyboardEvent<HTMLElement>) {
  const moves: Record<string, (i: number, n: number) => number> = {
    ArrowDown: (i, n) => (i + 1) % n,
    ArrowUp: (i, n) => (i - 1 + n) % n,
    Home: () => 0,
    End: (_i, n) => n - 1,
  };
  const move = moves[event.key];
  if (!move) return;
  const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>('a[href]'));
  const at = links.indexOf(document.activeElement as HTMLAnchorElement);
  if (at === -1) return;
  event.preventDefault();
  links[move(at, links.length)]?.focus();
}

function HarnessNav({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  const { search } = useHarnessAgent();
  const at = useMatch('/harness/:destination')?.params.destination;
  // One tab stop, not eight: the current page's link (or the first, on the list
  // itself) is reachable by Tab and the arrows walk the rest. `walkNav` said so
  // while every link kept `tabIndex 0`, so a keyboard user tabbed through all
  // eight anyway.
  const stop = HARNESS_DESTINATIONS.some((d) => d.path === at) ? at : HARNESS_DESTINATIONS[0]?.path;
  return (
    // The glance values are gone: Agent's is the picker above now, and Skills'
    // could only ever be the chat's `list_skills` — which disagreed with the
    // page's own header whenever that header had read the spec instead.
    <nav aria-label="Harness" className={cn('p-2', className)} onKeyDown={walkNav}>
      <HarnessAgentPicker />
      {GROUPS.map(({ key, label }) => (
        <Fragment key={key}>
          {/* Shown, not only announced. The labels were `aria-label`s and the rule
              between the runs was `border/60` — about 6% white in dark — so a
              screen reader heard two groups and everyone else saw eight rows. */}
          <hr aria-hidden className="mx-2.5 my-2 border-border" />
          <p
            id={`harness-nav-${key}`}
            className="px-2.5 pt-1 pb-1 text-xs font-medium text-muted-foreground"
          >
            {label}
          </p>
          <ul aria-labelledby={`harness-nav-${key}`} className="flex flex-col gap-0.5">
            {HARNESS_DESTINATIONS.filter((d) => d.group === key).map(
              ({ path, label: name, icon: Icon }) => (
                <li key={path}>
                  {/* The agent rides along: moving between pages keeps looking at
                      the same one. */}
                  <NavLink
                    to={{ pathname: path, search }}
                    onClick={onNavigate}
                    tabIndex={path === stop ? 0 : -1}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors',
                        'focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none',
                        isActive
                          ? 'bg-accent font-medium text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                      )
                    }
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{name}</span>
                  </NavLink>
                </li>
              ),
            )}
          </ul>
        </Fragment>
      ))}
    </nav>
  );
}

/**
 * Layout route for `/harness`.
 *
 * Wide, the nav is a resident rail beside the panel. Narrow, there is no room for
 * both, so `/harness` *is* the list and a destination is a page with a way back —
 * which is also why the index only redirects on a wide viewport. Redirecting on a
 * phone would mean the list could never be seen at all.
 */
export function HarnessLayout() {
  const wide = useMediaQuery('(min-width: 768px)');
  const atIndex = !!useMatch('/harness');
  const at = useMatch('/harness/:destination')?.params.destination;
  const place = HARNESS_DESTINATIONS.find((d) => d.path === at)?.label ?? 'Harness';
  const { search } = useHarnessAgent();

  // The tab strip names the page: eight open destinations all read "Felix chat".
  // Cleared on the way out, so the conversation's tab goes back to naming only
  // the run.
  useEffect(() => {
    setPresencePlace(place);
  }, [place]);
  useEffect(() => () => setPresencePlace(null), []);

  // The Ledger, not the first entry in the list. `/harness` is where an operator
  // comes back to, and the Ledger is the page that answers "what happened while
  // I was away"; Memory — first in the list — is empty for most tenants.
  if (atIndex && wide) return <Navigate to={{ pathname: 'ledger', search }} replace />;

  // Every shape below puts the destination in a `<main>`. The layout had a header
  // and a nav and no main, so a screen reader's landmark list offered every way
  // *around* the page and none into it, and "skip to main content" had nowhere to
  // land. Narrow, the index's list is the page's content, so it is the main there.
  if (!wide) {
    if (atIndex) {
      return (
        <main className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-border/60 px-4 py-3">
            {/* `h2`: the shell's wordmark is the page's one `h1`, and every
                destination's own heading is an `h2` beside this one. */}
            <h2 className="text-sm font-semibold">Harness</h2>
            <p className="text-xs text-muted-foreground">
              What this tenant owns, across every run.
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <HarnessNav />
          </div>
        </main>
      );
    }
    // The way back lives in the destination's own header, in the icon's place,
    // rather than in a row of its own above it: see `PageBack`.
    return (
      <PageBack.Provider value={{ to: `/harness${search}`, label: 'Back to Harness' }}>
        <main className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </main>
      </PageBack.Provider>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="w-56 shrink-0 overflow-y-auto border-r border-border/60">
        <HarnessNav />
      </div>
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Outlet />
      </main>
    </div>
  );
}
