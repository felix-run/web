import { Button } from '@felix/ui/button';
import { SparklesIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ErrorNotice } from '@/components/error-notice';
import { NameList } from '@/components/harness/panel';
import { Section, type SkillState } from '@/components/inspector/primitives';
import { middleTruncate } from '@/lib/format';

/**
 * Skills: what an agent's manifest has given it to work with.
 *
 * Two sources, and the page says which it is reading. The agent's own last
 * `list_skills` report knows what is *active*, but that report came from a
 * conversation, so it describes the chat's agent and nothing else; the manifest
 * knows only what is *declared*, for whichever agent the harness is looking at.
 *
 * There is no write in this half. A button used to post "list your skills" into
 * the chat's thread from this page, so its answer landed in a conversation that
 * was not on screen, addressed to an agent that might not be the one on this
 * page. It is a link to that conversation now: asking is something done in Chat.
 *
 * Below it, on `/harness/skills`, sits the tenant's skill **library** (`library`)
 * — what agents drafted and operators saved, and the queue of drafts waiting on
 * a person. That half is tenant-wide rather than per-agent, so it does not move
 * with the agent picker, and its pending count is the header's value when there
 * is one: a draft waiting is the thing on this page that asks for someone.
 */
export function SkillsSection({
  open,
  onToggle,
  skills,
  specSkills,
  agent,
  thread,
  isChatAgent = true,
  specError,
  onRetrySpec,
  chatTo,
  controls,
  library,
  pendingText,
}: {
  open: boolean;
  onToggle: () => void;
  /** The chat's last `list_skills` report, or `null` when there is none to show. */
  skills: SkillState | null;
  /**
   * The skills the manifest declares, read from its resolved spec: `undefined`
   * while that read is in flight or when the host does not provide one.
   */
  specSkills?: string[];
  /** The agent the page describes, named where it matters. */
  agent?: string;
  /** The conversation a `list_skills` report would come from. */
  thread?: { text: string; isId: boolean; to: string };
  isChatAgent?: boolean;
  /** Where Chat is, for when there is no known thread to name. */
  chatTo?: string;
  /** Why the spec could not be read, when it could not. */
  specError?: unknown;
  onRetrySpec?: () => void;
  /** Header controls — the agent picker, on `/harness`. */
  controls?: ReactNode;
  /** The tenant library and its review queue, drawn after the agent's skills. */
  library?: ReactNode;
  /** `3 drafts waiting`, when the review queue holds any. */
  pendingText?: string;
}) {
  const agentMeta = skills
    ? // `2/5` asked the reader to know which number was which; the words cost
      // three characters and remove the question.
      `${skills.active.length} of ${skills.declared.length} active`
    : specSkills
      ? `${specSkills.length} declared`
      : undefined;
  return (
    <Section
      icon={<SparklesIcon className="size-3.5" />}
      title="Skills"
      meta={pendingText ?? agentMeta}
      metaLead={pendingText ? agentMeta : undefined}
      metaTone={pendingText ? 'attention' : undefined}
      open={open}
      onToggle={onToggle}
      controls={controls}
    >
      <div className="space-y-3">
        {skills ? (
          <>
            <p className="text-sm text-muted-foreground">
              As of the agent's last <code className="font-mono">list_skills</code> call.
            </p>
            <div className="space-y-2.5">
              <SkillList label="Active" names={skills.active} kind="active" />
              <SkillList
                label="Declared"
                names={skills.declared}
                kind="declared"
                active={skills.active}
              />
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {isChatAgent ? (
                <>
                  Which are active is unknown until the agent calls{' '}
                  <code className="font-mono">list_skills</code> in a conversation.
                </>
              ) : (
                <>
                  Which are active is only known for the agent Chat is talking to; this is{' '}
                  <span className="font-mono text-foreground">{agent}</span>, as its manifest
                  declares it.
                </>
              )}
            </p>
            {specError != null ? (
              // Said, and retryable. The page used to fall silent here, which
              // read exactly like a manifest that declares no skills.
              <ErrorNotice
                error={specError}
                doing={`read ${agent ?? 'the agent'}'s manifest`}
                action={
                  onRetrySpec ? (
                    <Button
                      size="sm"
                      variant="outline"
                      className="self-start text-xs"
                      onClick={onRetrySpec}
                    >
                      Try again
                    </Button>
                  ) : undefined
                }
              />
            ) : specSkills ? (
              <SkillList label="Declared by the manifest" names={specSkills} kind="declared" />
            ) : (
              // Said, so an in-flight read is not the same picture as a manifest
              // that declares none — which now answers `[]` and reads "None".
              <p role="status" className="text-sm text-muted-foreground">
                Reading the manifest…
              </p>
            )}
          </>
        )}
        {thread && isChatAgent && (
          <p className="text-sm text-muted-foreground">
            From{' '}
            <Link
              to={thread.to}
              className="text-foreground underline underline-offset-2 hover:no-underline focus-visible:rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
            >
              {thread.isId ? (
                <>
                  the untitled thread{' '}
                  <span className="font-mono" title={thread.text}>
                    {middleTruncate(thread.text, 16)}
                  </span>
                </>
              ) : (
                thread.text
              )}
            </Link>
            {skills ? '.' : ', where asking it is one message.'}
          </p>
        )}
        {!thread && isChatAgent && !skills && chatTo && (
          <p className="text-sm text-muted-foreground">
            <Link
              to={chatTo}
              className="text-foreground underline underline-offset-2 hover:no-underline focus-visible:rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
            >
              Ask it in Chat
            </Link>{' '}
            to see which are active.
          </p>
        )}
      </div>
      {library ? <div className="mt-6 space-y-1">{library}</div> : null}
    </Section>
  );
}

function SkillList({
  label,
  names,
  kind,
  active = [],
}: {
  label: string;
  names: string[];
  kind: 'active' | 'declared';
  active?: string[];
}) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted-foreground">{label}</div>
      {names.length === 0 ? (
        <p className="text-sm text-muted-foreground">None</p>
      ) : (
        // The mono list Agent uses for the same data. In the declared list the
        // ones that are active stay in foreground and the rest go quiet, which
        // says what the check-mark pills said without a pill each.
        <NameList
          names={names}
          quiet={
            kind === 'declared' && active.length > 0 ? names.filter((n) => !active.includes(n)) : []
          }
        />
      )}
    </div>
  );
}
