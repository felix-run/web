import { Skeleton } from '@felix/ui/skeleton';
import { lazy, Suspense, useEffect, useState } from 'react';
import { AgentSheet } from '@/components/agent/agent-sheet';
import { modelsById } from '@/components/agent-select';
import { EvalSheet } from '@/components/eval/eval-sheet';
import { ActivityLedger } from '@/components/harness/activity-ledger';
import { AgentSkills } from '@/components/harness/agent-skills';
import { DocumentsSection } from '@/components/harness/documents';
import { GitHubPage } from '@/components/harness/github';
import { HarnessAgentPicker, useHarnessAgent } from '@/components/harness/harness-agent';
import { MemorySection } from '@/components/harness/memory';
import { Panel } from '@/components/harness/panel';
import { SkillsSection } from '@/components/harness/skills';
import { PanelModeProvider } from '@/components/inspector/primitives';
import { JobsSheet } from '@/components/jobs/jobs-sheet';
import { ManifestsSheet } from '@/components/manifests/manifests-sheet';
import { useSkillsAddress } from '@/components/skills/skills-address';
import { WorkflowsPage } from '@/components/workflows/workflows-page';
import { useShell } from '@/shell-context';
import { GITHUB_DOCS, type HarnessPath } from './harness';

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

function DocumentsPanel() {
  return (
    <AsPanel>
      <DocumentsSection enabled open onToggle={() => {}} />
    </AsPanel>
  );
}

/**
 * `/harness/skills`: the agent's skills, then the tenant library and its review
 * queue — or, with `?skill=`, one library skill's page. A search parameter
 * rather than a nested route, so the destination list (one path segment per
 * destination) stays the single table the nav and the routes are built from.
 */
function SkillsPanel() {
  const { skill } = useSkillsAddress();
  return skill ? (
    <Suspense fallback={<LibraryLoading />}>
      <SkillLibraryPage />
    </Suspense>
  ) : (
    <SkillsOverview />
  );
}

/**
 * The library and the skill page load on first visit: the editor carries a
 * YAML parser and the bundle validator, which nothing else in the app needs and
 * which the entry chunk should not pay for on every load. The chat's inline
 * skill card imports none of it.
 */
const SkillLibrary = lazy(() =>
  import('@/components/skills/skill-library').then((m) => ({ default: m.SkillLibraryEntry })),
);
const SkillLibraryPage = lazy(() =>
  import('@/components/skills/skill-library').then((m) => ({ default: m.SkillLibraryPageEntry })),
);

/** The library's section while its chunk loads: rows on the page's measure, as `PageLoading` draws. */
function LibraryLoading() {
  return (
    <div role="status" className="flex flex-col gap-2 py-4">
      <span className="sr-only">Loading the skill library…</span>
      <Skeleton aria-hidden className="h-4 w-32" />
      <Skeleton aria-hidden className="h-8 w-full rounded-md" />
      <Skeleton aria-hidden className="h-8 w-full rounded-md" />
    </div>
  );
}

function SkillsOverview() {
  // Reported up by the lazy library, which owns the queue's read.
  const [pendingText, setPendingText] = useState<string | undefined>(undefined);
  // Reported up by the agent's list, for the header.
  const [agentMeta, setAgentMeta] = useState<string | undefined>(undefined);
  const { agent } = useHarnessAgent();
  return (
    <AsPanel>
      <SkillsSection
        open
        onToggle={() => {}}
        agent={agent}
        agentMeta={agentMeta}
        controls={<HarnessAgentPicker />}
        library={
          <Suspense fallback={<LibraryLoading />}>
            <SkillLibrary onPendingText={setPendingText} />
          </Suspense>
        }
        pendingText={pendingText}
      >
        <AgentSkills key={agent} agent={agent} onCounts={setAgentMeta} />
      </SkillsSection>
    </AsPanel>
  );
}

/**
 * Activity: one entry per thread — what happened, what failed, what it cost.
 * The page is `ActivityLedger`; see it for why the Events/Usage halves went.
 */
function ActivityPanel() {
  return (
    <Panel>
      <ActivityLedger />
    </Panel>
  );
}

function ManifestsPanel() {
  const { refreshCanary, manifestOptions, manifestEntries } = useShell();
  const { agent } = useHarnessAgent();
  // The header badge reports the rollout this panel can change, so leaving is
  // what re-reads it. As a sheet this hung off `onOpenChange`; the route
  // equivalent of closing is unmounting.
  useEffect(() => refreshCanary, [refreshCanary]);
  return (
    <ManifestsSheet
      manifest={agent}
      bundled={manifestOptions}
      providerModels={modelsById(manifestEntries)}
    />
  );
}

function JobsPanel() {
  const { manifestOptions } = useShell();
  const { agent } = useHarnessAgent();
  return <JobsSheet manifest={agent} manifestOptions={manifestOptions} />;
}

function EvalPanel() {
  const { manifestOptions } = useShell();
  const { agent } = useHarnessAgent();
  return (
    <EvalSheet manifest={agent} manifestOptions={manifestOptions} picker={<HarnessAgentPicker />} />
  );
}

function GitHubPanel() {
  return <GitHubPage docs={GITHUB_DOCS} />;
}

function AgentPanel() {
  const { agent } = useHarnessAgent();
  return (
    <AgentSheet manifest={agent} picker={<HarnessAgentPicker labelledBy="agent-page-heading" />} />
  );
}

/**
 * One destination's page, by its path.
 *
 * The pages are this module's default export, loaded on the first visit to
 * `/harness` rather than with the app: every one of them is a workbench or a
 * record the conversation never needs, and together they were about a third of
 * the entry chunk's own source. The route table and the nav stay in
 * `harness.tsx`, which the sidebar imports, so the list of destinations is still
 * one list and costs nothing to draw.
 */
const PAGES: Record<HarnessPath, () => React.ReactNode> = {
  memory: MemoryPanel,
  documents: DocumentsPanel,
  skills: SkillsPanel,
  activity: ActivityPanel,
  agent: AgentPanel,
  github: GitHubPanel,
  manifests: ManifestsPanel,
  jobs: JobsPanel,
  workflows: WorkflowsPage,
  eval: EvalPanel,
};

export default function HarnessPage({ path }: { path: HarnessPath }) {
  const Page = PAGES[path];
  return <Page />;
}
