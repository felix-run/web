import {
  type Heartbeat,
  type HeartbeatRun,
  isNoPersonRefusal,
  type ManifestHeartbeat,
  relativeTime,
  threadSuffix,
} from '@felix/client';
import { Button } from '@felix/ui/button';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { deleteHeartbeat, listHeartbeats, runHeartbeat, setHeartbeat } from '@/api';
import { ConfirmButton } from '@/components/confirm-button';
import { ErrorNotice } from '@/components/error-notice';
import { Fact, Facts, PageSection } from '@/components/harness/panel';
import { isFailure, SectionBody } from '@/components/inspector/primitives';
import { usePoll } from '@/hooks/usePoll';
import { missingSources } from '@/lib/job-origin';
import { zonedScheduleLabel } from '@/lib/job-schedule';

/** Next and last run move on the schedule; a page left open follows at this pace. */
const POLL_MS = 30_000;
const RUN_DOING = 'run your heartbeat';

/** The answer of a firing that checked everything and found nothing (`felix/jobs/heartbeat.py`). */
const ALL_CLEAR = 'HEARTBEAT_OK';

/**
 * What a run did, in order of what would mislead most if said later. A skip comes before a failure
 * because a skip can carry an `error` too (`preferences_missing`), and "found nothing" is said only
 * for the answer that means it: `quiet` is just that no notice went out, which a run that could not
 * check something, or ran out of steps, also is.
 */
function runOutcome(run: HeartbeatRun): string {
  const { reason, max_firings_per_day: cap, quiet, answer } = run.result ?? {};
  if (reason === 'daily_cap') {
    return `Your heartbeat did not run: it has reached today's limit of ${cap}, counted in UTC.`;
  }
  if (run.status === 'skipped') {
    return run.error ? `Your heartbeat was skipped: ${run.error}.` : 'Your heartbeat was skipped.';
  }
  const missing = missingSources(run).join(', ');
  if (run.status === 'error') {
    const failed = run.error ? `Your heartbeat failed: ${run.error}.` : 'Your heartbeat failed.';
    return missing ? `${failed} It could not reach ${missing}.` : failed;
  }
  if (missing) {
    const found = quiet ? '' : ' Anything it found is in its conversation.';
    return `Your heartbeat ran, but could not reach ${missing}, so it may have missed something.${found}`;
  }
  if (!quiet) return 'Your heartbeat ran. Anything it found is in its conversation.';
  if (answer?.trim() === ALL_CLEAR) return 'Your heartbeat ran and found nothing to tell you.';
  return answer?.trim()
    ? `Your heartbeat ran and sent no notice. It said: ${answer.trim()}`
    : 'Your heartbeat ran and sent no notice.';
}

/**
 * The signed-in person's heartbeat on this agent, on the Agent page.
 *
 * The operator wrote what it checks and when; the person only decides whether it runs for them,
 * so this is the one part of the page that writes. `offer` is what `/v1/models` says the agent
 * has. Nothing is drawn for an agent with no offer and no heartbeat of theirs, even when the read
 * failed: a person who was never offered one has no use for a refusal about it. A heartbeat that
 * outlived its offer is still drawn, because the harness lets it be turned off or removed; turning
 * it back on is refused, and the page says why.
 */
export function AgentHeartbeat({ agent, offer }: { agent: string; offer?: ManifestHeartbeat }) {
  const mine = usePoll(listHeartbeats, { intervalMs: POLL_MS });
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState<{ err: unknown; doing: string } | null>(null);
  const [announce, setAnnounce] = useState('');
  // What the last write left, over the read it was made on. Run now does not check `enabled`, so
  // the button must not outlive the Turn off that stopped it by the length of a read. Any newer read
  // replaces it. `row: null` is a heartbeat just removed.
  const [written, setWritten] = useState<{ row: Heartbeat | null; over: unknown } | null>(null);
  // The read on screen when a write lands, not when it was clicked: one can arrive during the write.
  const latest = useRef(mine.data);
  latest.current = mine.data;
  const { refresh } = mine;
  const read = mine.data?.find((h) => h.manifest === agent);
  const row = written && written.over === mine.data ? written.row : read;

  async function act(doing: string, work: () => Promise<string>) {
    setBusy(doing);
    setFailure(null);
    setAnnounce('');
    try {
      setAnnounce(await work());
    } catch (err) {
      setFailure({ err, doing });
    } finally {
      setBusy(null);
      // On a refusal too: it usually means this row is out of date.
      refresh();
    }
  }

  if (!offer && !row && !announce && !failure) return null;

  if (!row && isNoPersonRefusal(mine.error)) {
    return (
      <PageSection title="Your heartbeat">
        <p className="text-sm text-muted-foreground">
          A heartbeat belongs to one signed-in person, and this session names no one.
        </p>
      </PageSection>
    );
  }

  const write = (next: Heartbeat | null) => setWritten({ row: next, over: latest.current });

  const turnOn = () =>
    act('turn on your heartbeat', async () => {
      write(await setHeartbeat(agent, true));
      return 'Your heartbeat is on. It first runs at its next scheduled time.';
    });
  const turnOff = () =>
    act('turn off your heartbeat', async () => {
      write(await setHeartbeat(agent, false));
      return 'Your heartbeat is off. Its conversation is kept.';
    });
  const remove = () =>
    act('remove your heartbeat', async () => {
      await deleteHeartbeat(agent);
      write(null);
      return 'Your heartbeat is removed. Its conversation is kept.';
    });
  const runNow = () => act(RUN_DOING, async () => runOutcome(await runHeartbeat(agent)));

  return (
    <PageSection title="Your heartbeat" meta={row ? (row.enabled ? 'on' : 'off') : undefined}>
      <SectionBody
        loading={!mine.data && !mine.error}
        error={mine.error}
        doing="read your heartbeats"
        onRetry={refresh}
        lastOkAt={mine.lastOkAt}
        // No `failures`: its one-read grace is for a blip, and a refusal here is standing. The
        // person would watch "Rechecking" for a whole poll. A 429 is still `transient` in there.
        emptyText=""
      >
        {row ? (
          <HeartbeatFacts row={row} />
        ) : (
          offer && (
            <p className="text-sm text-muted-foreground">
              {agent} can check in for you ({zonedScheduleLabel(offer.schedule, offer.timezone)}).
              Until you turn it off, it runs on its own, as you and with your access, and can act
              with any tool that needs no approval. The operator decides what it checks and can
              change that. It leaves a notice only when it finds something, and others with access
              to jobs or conversations here can read what it finds.
            </p>
          )
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {row?.enabled ? (
            <>
              <Button size="xs" variant="outline" disabled={!!busy} onClick={() => void runNow()}>
                {busy === RUN_DOING ? 'Running…' : 'Run now'}
              </Button>
              <Button size="xs" variant="ghost" disabled={!!busy} onClick={() => void turnOff()}>
                Turn off
              </Button>
            </>
          ) : (
            (row || offer) && (
              <Button size="xs" variant="outline" disabled={!!busy} onClick={() => void turnOn()}>
                Turn on
              </Button>
            )
          )}
          {row && (
            <ConfirmButton
              size="xs"
              variant="ghost"
              className="text-muted-foreground hover:text-state-failed"
              disabled={!!busy}
              destructive
              question={`Remove your heartbeat on ${agent}? Its run history, its preferences and the thread of each run go with it. Its conversation stays.`}
              confirmLabel="Remove heartbeat"
              onConfirm={() => remove()}
            >
              Remove
            </ConfirmButton>
          )}
        </div>
        {failure && <ErrorNotice error={failure.err} doing={failure.doing} />}
        {/* Always there, empty until it has news: a live region must exist before its text does. */}
        <p role="status" className="text-sm text-muted-foreground [&:not(:empty)]:mt-1">
          {announce}
        </p>
      </SectionBody>
    </PageSection>
  );
}

function HeartbeatFacts({ row }: { row: Heartbeat }) {
  const suffix = row.thread_id ? threadSuffix(row.thread_id) : '';
  const link = 'underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground';
  return (
    <Facts>
      <Fact label="Schedule">{zonedScheduleLabel(row.schedule, row.timezone)}</Fact>
      {row.enabled && (
        <Fact label="Next run" absent="not scheduled">
          {row.next_run_at ? new Date(row.next_run_at).toLocaleString() : null}
        </Fact>
      )}
      <Fact label="Last run" absent="not yet">
        {row.last_run_at ? (
          <>
            {relativeTime(row.last_run_at)}
            {row.last_status && (
              <span className={isFailure(row.last_status) ? 'text-state-failed' : undefined}>
                {' '}
                · {row.last_status}
              </span>
            )}
          </>
        ) : null}
      </Fact>
      {row.expires_at && (
        <Fact label="Stops">
          {new Date(row.expires_at).toLocaleString()}, when the sign-in that turned it on expires
        </Fact>
      )}
      <Fact label="Details">
        {suffix && (
          <>
            <Link to={`/t/${encodeURIComponent(suffix)}`} className={link}>
              Its conversation
            </Link>
            {' · '}
          </>
        )}
        <Link to={`/harness/jobs?job=${encodeURIComponent(row.name)}`} className={link}>
          Runs and preferences
        </Link>
      </Fact>
    </Facts>
  );
}
