import { PuzzleIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { PageSection } from '@/components/harness/panel';
import { Section } from '@/components/inspector/primitives';
import { cn } from '@/lib/utils';

/**
 * Skills: what an agent can work with, as the harness resolves it (`GET /skills/{manifest}`,
 * drawn by `AgentSkills` as `children`), for whichever agent the picker names.
 *
 * It used to read two second-hand sources: the chat's last `list_skills` report, which knew what
 * was active but described only the chat's agent, and the manifest's `spec.skills`, which knew
 * only what was declared. The route answers both for any agent, plus what neither could show —
 * a skill the model is never offered, one the host supplied unasked, one with no body.
 *
 * Below it, on `/harness/skills`, sits the tenant's skill **library** (`library`)
 * — what agents drafted and operators saved, and the queue of drafts waiting on
 * a person. While that queue holds a draft the library comes first: it is
 * the reason an operator opens this page the morning after an agent worked. That half is tenant-wide rather than per-agent, so it does not move
 * with the agent picker, and its pending count is the header's value when there
 * is one: a draft waiting is the thing on this page that asks for someone.
 */
export function SkillsSection({
  open,
  onToggle,
  agent,
  agentMeta,
  controls,
  library,
  pendingText,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  /** The agent the page describes, named where it matters. */
  agent?: string;
  /** `1 of 4 active`, once the agent's skills have been read. */
  agentMeta?: string;
  /** Header controls — the agent picker, on `/harness`. */
  controls?: ReactNode;
  /** The tenant library and its review queue, drawn after the agent's skills. */
  library?: ReactNode;
  /** `3 drafts waiting`, when the review queue holds any. */
  pendingText?: string;
  /** The agent's skills. */
  children: ReactNode;
}) {
  // A draft waiting is what this page asks someone for, so the queue leads
  // while it holds one; otherwise the agent's own skills, which change least,
  // stop being the first thing read on every visit only when there is
  // something else to read.
  const libraryBlock = library ? (
    <div className={cn('space-y-1', pendingText ? 'mb-6' : 'mt-6')}>{library}</div>
  ) : null;
  return (
    <Section
      icon={<PuzzleIcon className="size-3.5" />}
      title="Skills"
      meta={pendingText ?? agentMeta}
      metaLead={pendingText ? agentMeta : undefined}
      metaTone={pendingText ? 'attention' : undefined}
      open={open}
      onToggle={onToggle}
      controls={controls}
    >
      {pendingText && libraryBlock}
      <PageSection
        title={agent ? `Skills ${agent} can use` : 'Skills the agent can use'}
        // Below the library it is a section like the others, so it takes their
        // rule; first on the page it opens bare, as a first section does.
        className={pendingText ? 'border-t! pt-3!' : undefined}
      >
        {children}
      </PageSection>
      {!pendingText && libraryBlock}
    </Section>
  );
}
