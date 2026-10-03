import type { SkillDetail, SkillEval } from '@felix/client';
import { Button } from '@felix/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@felix/ui/collapsible';
import { Skeleton } from '@felix/ui/skeleton';
import { useQueryClient } from '@tanstack/react-query';
import {
  ChevronRightIcon,
  CircleCheckIcon,
  CircleDashedIcon,
  CircleXIcon,
  LoaderIcon,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { PageSection } from '@/components/harness/panel';
import { ReadFailure } from '@/components/inspector/primitives';
import { cn } from '@/lib/utils';
import {
  isStalled,
  skillKeys,
  useNowWhile,
  usePublishPolicy,
  useQueueEval,
  useSkillEvals,
} from './queries';
import { RefusalNotice } from './refusal';
import { ago } from './skill-status';
import { VersionPicker } from './version-picker';

const STATUS = {
  queued: { icon: CircleDashedIcon, word: 'queued', tone: 'text-muted-foreground' },
  running: { icon: LoaderIcon, word: 'running', tone: 'text-state-running' },
  succeeded: { icon: CircleCheckIcon, word: 'succeeded', tone: 'text-foreground' },
  failed: { icon: CircleXIcon, word: 'failed', tone: 'text-state-failed' },
} as const;

const SOURCE = {
  bundle: "the bundle's own evals/",
  generated: 'scenarios the model generated',
  default: "default scenarios from the skill's description",
} as const;

/** `+12`, `-3`, `0` — the sign is the reading, so it is always drawn. */
export function signed(n: number | null): string {
  if (n === null) return '—';
  return n > 0 ? `+${n}` : String(n);
}

/**
 * A version's evaluations: each scenario answered without and with the skill,
 * both scored 0-100 by a judge, and the difference.
 *
 * What a reviewer most needs from one is whether it *counts* — an agent's
 * version is held only to evaluations on its own bundle's `evals/`, because
 * generated and default scenarios are written from the agent's own text — so
 * that is the first thing each row says, in words, with the harness's reason.
 * Queued and running evaluations are re-read every few seconds until they
 * finish; the worker picks one up within a minute.
 */
export function EvalsPanel({
  detail,
  version,
  onVersion,
}: {
  detail: SkillDetail;
  version: string;
  onVersion: (v: string) => void;
}) {
  const name = detail.name;
  const evals = useSkillEvals(name, version);
  const all = useSkillEvals(name, null, { poll: false });
  const policy = usePublishPolicy();
  const queue = useQueueEval();
  const items = evals.data?.items ?? [];
  const busy = items.some((e) => e.status === 'queued' || e.status === 'running');
  const now = useNowWhile(busy);
  // The cross-version list does not poll, so when the polled evaluation
  // finishes it is told to: otherwise "Uplift by version" keeps the answer it
  // had before the evaluation ran.
  const client = useQueryClient();
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy) {
      void client.invalidateQueries({ queryKey: skillKeys.evals(name, null) });
    }
    wasBusy.current = busy;
  }, [busy, client, name]);
  const row = detail.versions.find((v) => v.version === version);
  const gated = policy.data && (policy.data.require_eval || policy.data.min_eval_uplift != null);

  return (
    <div className="space-y-1">
      <PageSection
        title="Evaluations"
        meta={evals.data ? `${items.length} for ${version}` : undefined}
        actions={
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={queue.isPending || busy}
            onClick={() =>
              queue.mutate(
                { name, version },
                { onSuccess: () => toast.success(`Queued an evaluation of ${name} ${version}.`) },
              )
            }
          >
            {busy ? 'One is in flight' : `Evaluate ${version}`}
          </Button>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <VersionPicker
            versions={detail.versions.map((v) => v.version)}
            value={version}
            onChange={onVersion}
          />
          {row && (
            <span className="text-xs text-muted-foreground">
              written by <span className="font-mono">{row.source}</span>
              {row.source === 'agent' &&
                ' — only an evaluation on its own evals/ scenarios counts for the gate'}
            </span>
          )}
        </div>
        {gated && (
          <p className="mb-2 text-xs text-muted-foreground">
            This tenant's gate needs a succeeded evaluation that counts
            {policy.data?.min_eval_uplift != null
              ? `, with an uplift of at least ${signed(policy.data.min_eval_uplift)}`
              : ''}
            , before a publish.
          </p>
        )}
        {queue.error ? (
          <RefusalNotice error={queue.error} doing={`evaluate ${name} ${version}`} />
        ) : null}
        {evals.error ? (
          <ReadFailure
            error={evals.error}
            doing={`read ${name}'s evaluations`}
            lastOkAt={evals.data ? evals.dataUpdatedAt : null}
            onRetry={() => void evals.refetch()}
          />
        ) : null}
        {evals.isPending ? (
          <Skeleton className="h-16 w-full rounded-md" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {version} has not been evaluated. The worker runs a queued evaluation within a minute.
          </p>
        ) : (
          <ul aria-label={`Evaluations of ${version}`} className="divide-y divide-border/60">
            {items.map((e) => (
              <EvalRow
                key={e.id}
                evaluation={e}
                now={now}
                onCheckAgain={() => void evals.refetch()}
              />
            ))}
          </ul>
        )}
      </PageSection>
      <UpliftByVersion evals={all.data?.items ?? []} />
    </div>
  );
}

export function EvalRow({
  evaluation: e,
  onCheckAgain,
  now,
}: {
  evaluation: SkillEval;
  /** The clock the stall is judged by; see `useNowWhile`. */
  now?: number;
  /** Re-read the list, for an evaluation the page has stopped polling. */
  onCheckAgain?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const s = STATUS[e.status];
  return (
    <li className="space-y-1.5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className={cn('inline-flex items-center gap-1 font-medium', s.tone)}>
          <s.icon
            aria-hidden
            className={cn('size-3.5', e.status === 'running' && 'motion-safe:animate-spin')}
          />
          {s.word}
        </span>
        <span className="text-xs text-muted-foreground">
          {ago(e.created_at)} by <span className="font-mono">{e.requested_by}</span>
        </span>
        {e.attempts > 1 && (
          <span className="font-mono text-xs text-muted-foreground">attempt {e.attempts}</span>
        )}
      </div>
      <p className={cn('text-xs', e.counts_for_gate ? 'font-medium' : 'text-muted-foreground')}>
        {e.counts_for_gate ? 'Counts for the publish gate.' : 'Does not count for the publish gate'}
        {!e.counts_for_gate && e.gate_note ? `: ${e.gate_note}` : e.counts_for_gate ? '' : '.'}
      </p>
      {e.status === 'succeeded' && (
        <p className="font-mono text-sm tabular-nums">
          <span className="sr-only">Baseline </span>
          {e.baseline_score} <span aria-hidden>→</span>
          <span className="sr-only"> with the skill </span> {e.with_skill_score}{' '}
          <span className="font-sans text-xs text-muted-foreground">uplift</span>{' '}
          <span className="font-semibold">{signed(e.uplift)}</span>
        </p>
      )}
      {e.status === 'failed' && (
        <p className="text-xs text-state-failed">
          Failed after {e.attempts} attempt{e.attempts === 1 ? '' : 's'}
          {e.error ? (
            <>
              : <span className="font-mono break-words">{e.error}</span>
            </>
          ) : (
            '.'
          )}
        </p>
      )}
      {(e.status === 'queued' || e.status === 'running') &&
        (isStalled(e, now) ? (
          <StalledNotice onCheckAgain={onCheckAgain} />
        ) : (
          <p className="text-xs text-muted-foreground" role="status">
            {e.status === 'queued'
              ? 'Waiting for the worker, which runs it within a minute.'
              : `Running since ${ago(e.started_at)}; last heartbeat ${ago(e.heartbeat_at)}.`}
          </p>
        ))}
      {e.scenario_source && (
        <p className="text-xs text-muted-foreground">
          On {SOURCE[e.scenario_source]}
          {e.model ? (
            <>
              {' '}
              · answered by <span className="font-mono">{e.model}</span>
            </>
          ) : null}
          {e.judge_model ? (
            <>
              {' '}
              · judged by <span className="font-mono">{e.judge_model}</span>
            </>
          ) : null}
        </p>
      )}
      {e.results.length > 0 && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="group inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <ChevronRightIcon
              aria-hidden
              className="size-3.5 transition-transform group-data-[state=open]:rotate-90"
            />
            {e.results.length} scenario{e.results.length === 1 ? '' : 's'}
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            <table className="w-full text-xs">
              <caption className="sr-only">Scores per scenario</caption>
              <thead>
                <tr className="text-left text-muted-foreground">
                  <th scope="col" className="py-1 font-medium">
                    Scenario
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Without
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    With
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Uplift
                  </th>
                </tr>
              </thead>
              <tbody>
                {e.results.map((r) => (
                  <ScenarioRow key={r.name} result={r} />
                ))}
              </tbody>
            </table>
          </CollapsibleContent>
        </Collapsible>
      )}
    </li>
  );
}

function ScenarioRow({ result: r }: { result: SkillEval['results'][number] }) {
  return (
    <>
      <tr className="border-t border-border/40 align-top">
        <th scope="row" className="py-1 pr-2 text-left font-mono font-normal">
          {r.name}
        </th>
        <td className="py-1 text-right font-mono tabular-nums">{r.baseline_score}</td>
        <td className="py-1 text-right font-mono tabular-nums">{r.with_skill_score}</td>
        <td className="py-1 text-right font-mono font-semibold tabular-nums">{signed(r.uplift)}</td>
      </tr>
      {(r.baseline_reason || r.with_skill_reason) && (
        <tr>
          <td colSpan={4} className="pb-2 text-muted-foreground">
            {r.baseline_reason && (
              <p className="whitespace-pre-wrap break-words">
                <span className="font-medium">Without:</span> {r.baseline_reason}
              </p>
            )}
            {r.with_skill_reason && (
              <p className="whitespace-pre-wrap break-words">
                <span className="font-medium">With:</span> {r.with_skill_reason}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/**
 * The newest succeeded evaluation of each version, oldest version first, and
 * how its uplift moved from the one before — a regression reads as a negative
 * change, in words as well as sign.
 */
function UpliftByVersion({ evals }: { evals: SkillEval[] }) {
  const latest = useMemo(() => {
    const byVersion = new Map<string, SkillEval>();
    for (const e of evals) {
      if (e.status !== 'succeeded' || e.uplift === null) continue;
      const seen = byVersion.get(e.version);
      if (!seen || e.created_at > seen.created_at) byVersion.set(e.version, e);
    }
    return [...byVersion.values()].sort((a, b) => a.created_at - b.created_at);
  }, [evals]);
  if (latest.length < 2) return null;
  return (
    <PageSection title="Uplift by version">
      <ul className="space-y-0.5 font-mono text-xs tabular-nums">
        {latest.map((e, i) => {
          const prev = latest[i - 1];
          const delta =
            prev && e.uplift !== null && prev.uplift !== null ? e.uplift - prev.uplift : null;
          return (
            <li key={e.id} className="flex flex-wrap gap-x-3">
              <span className="w-16">{e.version}</span>
              <span>
                {e.baseline_score} → {e.with_skill_score} ({signed(e.uplift)})
              </span>
              {delta !== null && (
                <span className={delta < 0 ? 'text-state-failed' : 'text-muted-foreground'}>
                  {delta < 0 ? 'down' : delta > 0 ? 'up' : 'level'} {signed(delta)} on{' '}
                  {prev?.version}
                  {!e.counts_for_gate && ' (does not count)'}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </PageSection>
  );
}

/**
 * A job that has not moved for `STALL_MS`: the page has stopped polling it,
 * and says the likely reason rather than spinning on.
 */
export function StalledNotice({ onCheckAgain }: { onCheckAgain?: () => void }) {
  return (
    <div role="status" className="flex flex-wrap items-center gap-2 text-xs text-state-blocked">
      <span>
        The worker hasn’t picked this up in five minutes. Is{' '}
        <span className="font-mono">felix-worker</span> running alongside{' '}
        <span className="font-mono">felix-scheduler</span>?
      </span>
      {onCheckAgain && (
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onCheckAgain}>
          Check again
        </Button>
      )}
    </div>
  );
}
