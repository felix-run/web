import {
  type AgentSkill,
  type AgentSkillDetail,
  type SkillActivation,
  threadSuffix,
} from '@felix/client';
import { Badge } from '@felix/ui/badge';
import { ChevronRightIcon } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { getAgentSkill, listAgentSkills, recentSkillActivations } from '@/api';
import { ErrorNotice } from '@/components/error-notice';
import { PageSection, plural } from '@/components/harness/panel';
import { relTime, SectionBody } from '@/components/inspector/primitives';
import { usePoll } from '@/hooks/usePoll';
import { middleTruncate } from '@/lib/format';
import { threadLabel } from '@/lib/threads';
import { cn } from '@/lib/utils';
import { useShell } from '@/shell-context';

/** Active skills change as a run switches them; a page left open follows at this pace. */
const POLL_MS = 30_000;
const ACTIVATIONS_SHOWN = 20;

/**
 * An agent's skills as the harness resolves them now (`GET /skills/{manifest}`), for any agent
 * on the picker — not the chat agent's last `list_skills` report, and not only what its
 * manifest names. Each row says what a transcript cannot: whether the model is ever offered it,
 * whether the manifest asked for it or the host supplied it, and whether there is a body at all.
 * A row opens onto the instructions `activate_skill` would hand the model, as the harness reads
 * them (secrets redacted). Under it, which skill was switched on or off on which turn.
 */
export function AgentSkills({
  agent,
  onCounts,
}: {
  agent: string;
  /** `1 of 4 active`, for the page header, once the list has been read. */
  onCounts?: (meta: string | undefined) => void;
}) {
  const fetchSkills = useCallback(() => listAgentSkills(agent), [agent]);
  const skills = usePoll(fetchSkills, { intervalMs: POLL_MS });
  const fetchActivations = useCallback(
    () => recentSkillActivations(agent, ACTIVATIONS_SHOWN),
    [agent],
  );
  const activations = usePoll(fetchActivations, { intervalMs: POLL_MS });
  const items = skills.data?.items ?? [];
  const active = items.filter((s) => s.active).length;
  const loaded = skills.data !== undefined;
  useEffect(() => {
    onCounts?.(loaded ? `${active} of ${plural(items.length, 'skill')} active` : undefined);
  }, [onCounts, loaded, active, items.length]);

  return (
    <div className="space-y-4">
      <SectionBody
        loading={skills.loading && !skills.data}
        error={skills.error}
        doing={`list ${agent}'s skills`}
        onRetry={skills.refresh}
        lastOkAt={skills.lastOkAt}
        failures={skills.failures}
        empty={items.length === 0}
        emptyText={`${agent} can reach no skills.`}
      >
        <p className="mb-2 text-sm text-muted-foreground">
          {plural(items.length, 'skill')}, {active} active.{' '}
          {skills.data?.declared_only
            ? 'Limited to the skills its manifest names.'
            : 'The manifest names some; the rest are on the host, and the model is offered them too.'}
        </p>
        <ul aria-label={`Skills ${agent} can reach`} className="text-sm">
          {items.map((s) => (
            <SkillRow key={s.name} agent={agent} skill={s} />
          ))}
        </ul>
      </SectionBody>

      <PageSection title="Recent activations">
        <SectionBody
          loading={activations.loading && !activations.data}
          error={activations.error}
          doing={`read ${agent}'s recent skill activations`}
          onRetry={activations.refresh}
          lastOkAt={activations.lastOkAt}
          failures={activations.failures}
          empty={(activations.data ?? []).length === 0}
          emptyText={`No skill has been switched on or off for ${agent}.`}
        >
          <ActivationList rows={activations.data ?? []} />
        </SectionBody>
      </PageSection>
    </div>
  );
}

function SkillRow({ agent, skill: s }: { agent: string; skill: AgentSkill }) {
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<AgentSkillDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const bodyId = `agent-skill-${s.name}`;
  async function toggle() {
    const next = !open;
    setOpen(next);
    if (!next || detail) return;
    setError(null);
    try {
      setDetail(await getAgentSkill(agent, s.name));
    } catch (err) {
      setError(err);
    }
  }
  return (
    <li data-slot="agent-skill" className="border-b border-border/60 py-1.5 first:border-t">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => void toggle()}
          className="flex min-w-0 items-center gap-1 rounded-sm font-mono font-medium focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
        >
          <ChevronRightIcon
            aria-hidden
            className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')}
          />
          {s.name}
        </button>
        {s.active && (
          <Badge variant="secondary" className="py-0 text-xs">
            active
          </Badge>
        )}
        {/* Said only off the default, so the exception is what is read. */}
        {!s.declared && <span className="text-xs text-muted-foreground">from the host</span>}
        {!s.model_invocable && (
          <span className="text-xs text-muted-foreground" title="disable_model_invocation">
            never offered to the model
          </span>
        )}
        {!s.has_body && (
          <span className="text-xs font-medium text-state-failed">
            no body — activating it gives the model nothing
          </span>
        )}
        <span className="ml-auto font-mono text-xs text-muted-foreground">
          {[s.source, s.version ? `v${s.version}` : null].filter(Boolean).join(' · ')}
        </span>
      </div>
      {s.description && (
        <p className="mt-0.5 pl-4.5 text-sm text-muted-foreground">{s.description}</p>
      )}
      {open && (
        <div id={bodyId} className="mt-1.5 pl-4.5">
          {error != null ? (
            <ErrorNotice error={error} doing={`read the ${s.name} skill`} />
          ) : detail === null ? (
            <p className="text-sm text-muted-foreground">Reading the skill…</p>
          ) : detail.body ? (
            // As text, not rendered: these are instructions to a model, and what is
            // being checked is exactly what it would be handed.
            <pre className="max-h-80 overflow-auto rounded-md bg-ground p-3 font-mono text-xs leading-snug whitespace-pre-wrap">
              {detail.body}
            </pre>
          ) : (
            <p className="text-sm text-muted-foreground">This skill has no instructions.</p>
          )}
          {detail?.filename && (
            <p className="mt-1 font-mono text-xs text-muted-foreground">{detail.filename}</p>
          )}
        </div>
      )}
    </li>
  );
}

function ActivationList({ rows }: { rows: SkillActivation[] }) {
  const { threads } = useShell();
  return (
    <ol className="space-y-0.5 text-sm">
      {rows.map((r, i) => {
        const suffix = r.thread_id ? threadSuffix(r.thread_id) : '';
        const meta = suffix ? threads.find((t) => t.id === suffix) : undefined;
        const label = meta ? threadLabel(meta) : suffix ? { text: suffix, isId: true } : null;
        return (
          <li
            key={`${r.ts}-${r.tool_call_id || i}`}
            className="grid grid-cols-[3rem_minmax(0,1fr)] items-baseline gap-2"
          >
            <span className="text-xs text-muted-foreground tabular-nums">{relTime(r.ts)}</span>
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span className={r.action === 'deactivate' ? 'text-muted-foreground' : undefined}>
                {r.action === 'deactivate' ? 'switched off' : 'switched on'}
              </span>
              <span className="font-mono">{r.skill || '—'}</span>
              {r.status && r.status !== 'ok' && (
                <span className="text-xs font-medium text-state-failed">
                  {r.status === 'unknown_skill' ? 'no such skill' : r.status}
                </span>
              )}
              {label && (
                <Link
                  to={`/t/${suffix}`}
                  className="min-w-0 truncate text-xs text-muted-foreground underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground"
                  title={label.text}
                >
                  {label.isId ? middleTruncate(label.text, 16) : label.text}
                </Link>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
