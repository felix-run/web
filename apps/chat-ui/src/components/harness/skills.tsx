import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import { CheckCircle2Icon, SparklesIcon } from 'lucide-react';
import { Section, type SkillState } from '@/components/inspector/primitives';
import { middleTruncate } from '@/lib/format';

/**
 * Skills: what the active manifest has given the agent to work with.
 *
 * Two sources, and the page says which it is reading. The agent's own last
 * `list_skills` report knows what is *active*; the manifest knows only what is
 * *declared*. The page used to show the first or nothing — so until the agent had
 * been asked in this session, a Record page was empty except for a full-width
 * button that posted to a thread the operator could not see. The declared list
 * comes from the spec, which is always there, and the button is a small action
 * under it rather than the heaviest thing on the page.
 */
export function SkillsSection({
  open,
  onToggle,
  skills,
  specSkills,
  onSuggest,
  busy,
  target,
}: {
  open: boolean;
  onToggle: () => void;
  skills: SkillState | null;
  /**
   * The skills the manifest declares, read from its resolved spec: `undefined`
   * while that read is in flight or when the host does not provide one.
   */
  specSkills?: string[];
  onSuggest: (text: string) => void;
  busy?: boolean;
  /** The thread the ask posts to, since from here it is not on screen. */
  target?: { text: string; isId: boolean };
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
              Which are active is unknown until the agent calls{' '}
              <code className="font-mono">list_skills</code>.
            </p>
            {specSkills && (
              <SkillList label="Declared by the manifest" names={specSkills} kind="declared" />
            )}
          </>
        )}
        {/* It posts to the thread, so it says which one, and it stands down
            mid-run: `send` steers an in-flight run rather than starting a turn, so
            firing this during a stream would inject an unrelated instruction into
            whatever the agent is currently doing. */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          <Button
            size="sm"
            variant="outline"
            className="h-7"
            disabled={busy}
            onClick={() => onSuggest('List your skills: which are declared, and which are active?')}
          >
            Ask the agent
          </Button>
          <span className="min-w-0">
            {busy ? (
              'Available once the current run finishes.'
            ) : (
              <>
                Posts "list your skills" to <Target target={target} />.
              </>
            )}
          </span>
        </div>
      </div>
    </Section>
  );
}

/**
 * The thread the ask lands in, named the way the thread list names it. An
 * untitled thread's only name is its id, which is 36 characters of UUID in a
 * sentence — so it says *untitled* and keeps both ends of the id, the way every
 * other place a thread id is drawn does.
 */
function Target({ target }: { target?: { text: string; isId: boolean } }) {
  if (!target) return <>this chat</>;
  if (!target.isId) return <span className="text-foreground">{target.text}</span>;
  return (
    <>
      the untitled thread{' '}
      <span className="font-mono" title={target.text}>
        {middleTruncate(target.text, 16)}
      </span>
    </>
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
