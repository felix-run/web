import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import { CheckCircle2Icon, SparklesIcon } from 'lucide-react';
import { Section, type SkillState } from '@/components/inspector/primitives';
import { cn } from '@/lib/utils';

/** Skills: what the active manifest has given the agent to work with. */

export function SkillsSection({
  open,
  onToggle,
  skills,
  onSuggest,
  busy,
  target,
}: {
  open: boolean;
  onToggle: () => void;
  skills: SkillState | null;
  onSuggest: (text: string) => void;
  busy?: boolean;
  /**
   * The thread the button posts to, when it is not the one on screen. Omitted in
   * the inspector, where "this chat" is the transcript beside it.
   */
  target?: { text: string; isId: boolean };
}) {
  return (
    <Section
      icon={<SparklesIcon className="size-3.5" />}
      title="Skills"
      // `2/5` asked the reader to know which number was which; the words cost
      // three characters and remove the question.
      meta={skills ? `${skills.active.length} of ${skills.declared.length} active` : undefined}
      open={open}
      onToggle={onToggle}
    >
      <div className="space-y-3">
        {/* Where the list comes from, said once and short: it is the agent's last
            report, not the manifest, so it can be stale. How skills activate is
            something the operator configured and does not need re-read per visit. */}
        {skills ? (
          <p className="text-xs text-muted-foreground">
            As of the agent's last <code className="font-mono">list_skills</code> call.
          </p>
        ) : null}
        {skills ? (
          <div className="space-y-2.5">
            <SkillList label="Active" names={skills.active} kind="active" />
            <SkillList
              label="Declared"
              names={skills.declared}
              kind="declared"
              active={skills.active}
            />
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            No <code className="rounded bg-muted px-1 py-0.5 font-mono">list_skills</code> result in
            this session yet.
          </p>
        )}
        {/* This is the only control outside the composer that posts to the thread, so
            it says so, and it stands down mid-run: `send` steers an in-flight run
            rather than starting a turn, so firing this during a stream would inject
            an unrelated instruction into whatever the agent is currently doing. */}
        <Button
          size="sm"
          variant="outline"
          className="h-auto min-h-8 w-full justify-start py-1.5 text-left whitespace-normal"
          disabled={busy}
          onClick={() => onSuggest('List your skills: which are declared, and which are active?')}
        >
          <span className="min-w-0">
            Send "list your skills" to{' '}
            {target ? (
              <span className={cn('break-all', target.isId && 'font-mono')}>{target.text}</span>
            ) : (
              'this chat'
            )}
          </span>
        </Button>
        {busy && (
          <p className="text-xs text-muted-foreground">Available once the current run finishes.</p>
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
