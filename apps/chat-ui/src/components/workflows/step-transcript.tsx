import { eventsToTurns, snapshotToEvents } from '@felix/client';
import { useEffect, useMemo, useState } from 'react';
import { getWorkflowStepThread, WorkflowRouteError } from '@/api';
import { Message } from '@/components/chat/message';
import { ErrorNotice } from '@/components/error-notice';
import type { SessionSnapshot } from '@/types';

type Loaded =
  | { kind: 'loading' }
  | { kind: 'none' }
  | { kind: 'error'; error: unknown }
  | { kind: 'ok'; snapshot: SessionSnapshot };

/**
 * What a step's child run said and did: its thread, read under the run, drawn read-only with the
 * chat's own turns. Re-read whenever the run's record changes (`version`), so a running step's
 * transcript follows the poll; what was read stays on screen while the next read is in flight.
 */
export function StepTranscript({
  workflowId,
  runId,
  stepId,
  version,
}: {
  workflowId: string;
  runId: string;
  stepId: string;
  version: number;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  // A different step starts from nothing, rather than showing the last one's turns under its name.
  useEffect(() => setLoaded({ kind: 'loading' }), [workflowId, runId, stepId]);
  // `version` is the re-read signal: the run's record changed, so the step's thread may have.
  useEffect(() => {
    let live = true;
    getWorkflowStepThread(workflowId, runId, stepId).then(
      (snapshot) => live && setLoaded({ kind: 'ok', snapshot }),
      (error: unknown) => {
        if (!live) return;
        const missing = error instanceof WorkflowRouteError && error.status === 404;
        setLoaded(missing ? { kind: 'none' } : { kind: 'error', error });
      },
    );
    return () => {
      live = false;
    };
  }, [workflowId, runId, stepId, version]);

  const turns = useMemo(
    () => (loaded.kind === 'ok' ? eventsToTurns(snapshotToEvents(loaded.snapshot)) : []),
    [loaded],
  );

  return (
    <div>
      <div className="mb-1 text-xs text-muted-foreground">Transcript</div>
      {loaded.kind === 'loading' ? (
        <p className="text-sm text-muted-foreground">Reading the transcript…</p>
      ) : loaded.kind === 'error' ? (
        <ErrorNotice error={loaded.error} doing="read this step's transcript" />
      ) : loaded.kind === 'none' || !turns.length ? (
        <p className="text-sm text-muted-foreground">Nothing in it yet.</p>
      ) : (
        <div className="space-y-5 rounded-md border border-border/40 bg-background p-3">
          {turns.map((turn) => (
            <Message key={turn.id} turn={turn} />
          ))}
        </div>
      )}
    </div>
  );
}
