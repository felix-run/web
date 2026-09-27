import { Badge } from '@felix/ui/badge';
import { CheckCircle2Icon, SparklesIcon } from 'lucide-react';
import { Link } from 'react-router';
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
 * There is no write here. A button used to post "list your skills" into the
 * chat's thread from this page, so its answer landed in a conversation that was
 * not on screen, addressed to an agent that might not be the one on this page.
 * It is a link to that conversation now: asking is something done in Chat.
 */
export function SkillsSection({
  open,
  onToggle,
  skills,
  specSkills,
  agent,
  thread,
  isChatAgent = true,
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
}) {
  const meta = skills
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
      meta={meta}
      open={open}
      onToggle={onToggle}
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
            {specSkills && (
              <SkillList label="Declared by the manifest" names={specSkills} kind="declared" />
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
      </div>
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
        <p className="text-xs text-muted-foreground">None</p>
      ) : (
        <div className="flex flex-wrap gap-1">
          {names.map((n) => {
            const isActive = kind === 'active' || active.includes(n);
            return (
              <Badge
                key={n}
                variant={isActive && kind === 'active' ? 'default' : 'secondary'}
                className="gap-1 font-mono text-xs"
              >
                {kind === 'active' && <CheckCircle2Icon className="size-3" />}
                {n}
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}
