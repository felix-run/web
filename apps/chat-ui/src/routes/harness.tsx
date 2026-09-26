import { Button } from '@felix/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@felix/ui/tabs';
import {
  ActivityIcon,
  BookOpenIcon,
  BotIcon,
  BrainIcon,
  ChevronLeftIcon,
  ClockIcon,
  FlaskConicalIcon,
  GitBranchIcon,
  type LucideIcon,
  SparklesIcon,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, NavLink, Outlet, useMatch } from 'react-router';
import { AgentSheet } from '@/components/agent/agent-sheet';
import { EvalSheet } from '@/components/eval/eval-sheet';
import { DocumentsSection } from '@/components/harness/corpus';
import { ActivitySection, UsageSection } from '@/components/harness/ledger';
import { MemorySection } from '@/components/harness/memory';
import { PageHeader, Panel } from '@/components/harness/panel';
import { SkillsSection } from '@/components/harness/skills';
import {
  PanelModeProvider,
  type SectionMeta,
  SectionMetaSink,
} from '@/components/inspector/primitives';
import { JobsSheet } from '@/components/jobs/jobs-sheet';
import { ManifestsSheet } from '@/components/manifests/manifests-sheet';
import { useMediaQuery } from '@/hooks/useMediaQuery';
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
  const { skills, send, streaming } = useShell();
  return (
    <AsPanel>
      <SkillsSection open onToggle={() => {}} skills={skills} onSuggest={send} busy={streaming} />
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
  const [half, setHalf] = useState<'activity' | 'usage'>('activity');
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
          valueTone={meta.metaTone}
          // The halves hold their rows to the reading measure, so the switch
          // between them ends where those rows end rather than at the pane's edge.
          measured
          controls={
            <TabsList aria-label="Ledger view" className="w-auto">
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
  const { manifest, refreshCanary } = useShell();
  // The header badge reports the rollout this panel can change, so leaving is
  // what re-reads it. As a sheet this hung off `onOpenChange`; the route
  // equivalent of closing is unmounting.
  useEffect(() => refreshCanary, [refreshCanary]);
  return <ManifestsSheet manifest={manifest} />;
}

function JobsPanel() {
  const { manifest, manifestOptions } = useShell();
  return <JobsSheet manifest={manifest} manifestOptions={manifestOptions} />;
}

function EvalPanel() {
  const { manifest } = useShell();
  return <EvalSheet manifest={manifest} />;
}

function AgentPanel() {
  const { manifest } = useShell();
  return <AgentSheet manifest={manifest} />;
}

/**
 * The eight destinations, declared once.
 *
 * The nav and the route table are built from this same list, because a nav entry
 * with no route is a dead link and a route with no nav entry is a page nobody can
 * reach — and both of those are silent.
 */
export const HARNESS_DESTINATIONS: {
  path: string;
  label: string;
  icon: LucideIcon;
  element: React.ReactNode;
}[] = [
  { path: 'memory', label: 'Memory', icon: BrainIcon, element: <MemoryPanel /> },
  { path: 'corpus', label: 'Corpus', icon: BookOpenIcon, element: <CorpusPanel /> },
  { path: 'skills', label: 'Skills', icon: SparklesIcon, element: <SkillsPanel /> },
  { path: 'ledger', label: 'Ledger', icon: ActivityIcon, element: <LedgerPanel /> },
  { path: 'manifests', label: 'Manifests', icon: GitBranchIcon, element: <ManifestsPanel /> },
  { path: 'jobs', label: 'Jobs', icon: ClockIcon, element: <JobsPanel /> },
  { path: 'eval', label: 'Eval', icon: FlaskConicalIcon, element: <EvalPanel /> },
  { path: 'agent', label: 'Agent', icon: BotIcon, element: <AgentPanel /> },
];

function HarnessNav({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  const { skills, manifest } = useShell();
  // A value only where the shell already holds it. Every other destination's
  // number comes from its own fetch, which runs only while that page is the
  // address — putting those here would mean eight polls behind a list of links,
  // each paid for a label nobody opened the page to read.
  const glance: Record<string, { text: string; mono?: boolean } | undefined> = {
    skills: skills ? { text: `${skills.active.length} active` } : undefined,
    agent: manifest ? { text: manifest, mono: true } : undefined,
  };
  return (
    <nav aria-label="Harness" className={cn('flex flex-col gap-0.5 p-2', className)}>
      {HARNESS_DESTINATIONS.map(({ path, label, icon: Icon }) => (
        <NavLink
          key={path}
          to={path}
          onClick={onNavigate}
          className={({ isActive }) =>
            cn(
              'flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
              isActive
                ? 'bg-accent font-medium text-accent-foreground'
                : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
            )
          }
        >
          <Icon className="size-4 shrink-0" />
          <span className="truncate">{label}</span>
          {glance[path] && (
            <span
              className={cn(
                'ml-auto min-w-0 truncate pl-2 text-xs font-normal tabular-nums text-muted-foreground',
                glance[path]?.mono && 'font-mono',
              )}
            >
              {glance[path]?.text}
            </span>
          )}
        </NavLink>
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

  if (atIndex && wide) return <Navigate to="memory" replace />;

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
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border/60 px-2 py-1.5">
          <Button asChild variant="ghost" size="sm" className="gap-1.5">
            <Link to="/harness">
              <ChevronLeftIcon className="size-4" />
              Harness
            </Link>
          </Button>
        </div>
        <main className="flex min-h-0 flex-1 flex-col">
          <Outlet />
        </main>
      </div>
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
