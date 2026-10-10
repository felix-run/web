import { threadSuffix, type UsageEvent } from '@felix/client';
import { Button } from '@felix/ui/button';
import { CheckIcon, CopyIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { listUsage } from '@/api';
import { DebugId } from '@/components/chat/turn-debug';
import { ReadFailure, tsToMs } from '@/components/inspector/primitives';
import { usePoll } from '@/hooks/usePoll';
import { clockTime } from '@/lib/format';
import { cn } from '@/lib/utils';
import { type ClientDiagnostics, type EngineReport, useShell } from '@/shell-context';

/** How many of the thread's metered calls the tab reads. */
export const DEBUG_CALLS = 20;

const nf = new Intl.NumberFormat();

/**
 * The Debug tab: what this tab believes about the thread, its lease and every run
 * it carries, and what the harness metered for the thread — with one action that
 * copies all of it as a report someone else can act on.
 *
 * The client half costs no request. It is re-read from the shell once a second
 * while the tab is open, because the engine's stream and lease figures are kept
 * in closures that notify nobody when, say, a stream's quiet time grows; reading
 * them is a handful of property loads. The harness half is one `/usage` read for
 * this thread, polled only while this tab is the open one.
 *
 * Per-call figures are listed as the harness metered them, by time, and not
 * matched to turns: a turn carries no timestamp, and a call drawn under the wrong
 * turn is worse than a list that says when each one ran.
 */
export function DebugSection({ enabled }: { enabled: boolean }) {
  const { inspectClient, threadId } = useShell();
  const [, tick] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    const id = window.setInterval(() => tick((n) => n + 1), 1000);
    return () => window.clearInterval(id);
  }, [enabled]);
  const client = inspectClient();

  const calls = usePoll(() => listUsage({ thread_id: threadId, limit: DEBUG_CALLS }), {
    enabled,
    intervalMs: 10_000,
  });
  const callRows = threadCalls(calls.data?.items, threadId);

  return (
    <div className="space-y-5 text-xs">
      <div className="flex items-start justify-between gap-3">
        <p className="text-muted-foreground">
          This tab · what the client believes, and what the harness metered
        </p>
        <CopyReport client={client} calls={callRows} />
      </div>

      <Group title="Thread">
        <Row label="Thread">
          <DebugId bare label="thread" value={client.threadId} keep={24} />
        </Row>
        <Row label="Leaf">
          {client.leaf ? (
            <DebugId bare label="leaf" value={client.leaf} keep={24} />
          ) : (
            <Absent>no server event on screen yet</Absent>
          )}
        </Row>
        <Row label="Agent">
          <Mono>{client.manifest}</Mono>
          {client.threadAgent && client.threadAgent !== client.manifest && (
            <span className="text-muted-foreground"> · last ran {client.threadAgent}</span>
          )}
        </Row>
        <Row label="Canary">
          {client.canary ? (
            <Mono>
              v{client.canary.version} @ {client.canary.weight}% ·{' '}
              {client.canary.onCanary ? 'this thread on it' : 'not confirmed on it'}
            </Mono>
          ) : (
            <Absent>no rollout in flight</Absent>
          )}
        </Row>
        <Row label="Turns">
          <Mono>{client.turns}</Mono>
        </Row>
        <Row label="Harness">
          {client.harnessReachable ? (
            'answered the last request'
          ) : (
            <span className="text-state-failed">last request did not arrive</span>
          )}
        </Row>
      </Group>

      <Group title="Lease">
        <Row label="Holder">
          <DebugId bare label="holder" value={client.holderId} keep={24} />
        </Row>
        <Row label="Mode">
          {client.lease.mode ? (
            <Mono>
              {client.lease.mode}
              {client.lease.heldByOther ? ' · another client drives' : ''}
            </Mono>
          ) : (
            <Absent>none held</Absent>
          )}
        </Row>
        <Row label="Token">
          {client.lease.token ? <Mono>{redact(client.lease.token)}</Mono> : <Absent>none</Absent>}
        </Row>
      </Group>

      <Group
        title="Engines"
        fields={false}
        note={`${client.engines.length} in this tab — one per thread with a run or on screen`}
      >
        {client.engines.length === 0 ? (
          <Absent>none</Absent>
        ) : (
          <ul className="space-y-3">
            {client.engines.map((e) => (
              <EngineRow key={e.threadId} engine={e} current={e.threadId === client.threadId} />
            ))}
          </ul>
        )}
      </Group>

      <Group
        title="Model calls"
        fields={false}
        note={`This thread · the last ${DEBUG_CALLS} the harness metered`}
      >
        {calls.error ? (
          <ReadFailure
            error={calls.error}
            doing="read this thread's usage"
            lastOkAt={calls.lastOkAt}
            onRetry={calls.refresh}
          />
        ) : null}
        {calls.data === undefined ? (
          calls.error ? null : (
            <Absent>Reading…</Absent>
          )
        ) : callRows === 'unattributed' ? (
          <Absent>This harness does not attribute calls to threads.</Absent>
        ) : callRows.length === 0 ? (
          <Absent>None metered on this thread yet.</Absent>
        ) : (
          <ol className="space-y-2">
            {callRows.map((r) => (
              <CallRow key={r.id} row={r} />
            ))}
          </ol>
        )}
      </Group>
    </div>
  );
}

function EngineRow({ engine: e, current }: { engine: EngineReport; current: boolean }) {
  const d = e.diagnostics;
  const state = e.approvals || e.question ? 'blocked' : e.streaming ? 'running' : 'idle';
  return (
    <li className="space-y-1">
      <div className="flex flex-wrap items-center gap-x-1.5">
        <span
          aria-hidden
          className={cn(
            'size-1.5 shrink-0 rounded-full',
            state === 'blocked'
              ? 'bg-state-blocked'
              : state === 'running'
                ? 'bg-state-running'
                : 'bg-muted-foreground/50',
          )}
        />
        {current ? (
          <span className="font-mono">{e.threadId}</span>
        ) : (
          <Link to={`/t/${e.threadId}`} className="font-mono underline underline-offset-2">
            {e.threadId}
          </Link>
        )}
        <span className="text-muted-foreground">
          {[
            current ? 'on screen' : e.foreground ? 'foreground' : 'background',
            state,
            e.pins ? `pinned ×${e.pins}` : '',
          ]
            .filter(Boolean)
            .join(' · ')}
        </span>
      </div>
      <dl className="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 pl-3">
        <Row label="Phase">
          <Mono>{e.phase}</Mono>
          {e.reattaching && <span className="text-muted-foreground"> · reattaching</span>}
        </Row>
        <Row label="Durable run">
          {d.resumeToken ? (
            <>
              <DebugId bare label="resume token" value={d.resumeToken} />
              {d.durableStatus && <Mono> · {d.durableStatus}</Mono>}
            </>
          ) : (
            <Absent>none</Absent>
          )}
        </Row>
        <Row label="Cursor">
          {d.cursor ? <Mono>{d.cursor}</Mono> : <Absent>no id: frame yet</Absent>}
        </Row>
        <Row label="Stream">
          {d.stream ? (
            <Mono>
              quiet {formatQuiet(d.stream.quietMs)} ·{' '}
              {d.stream.heartbeats ? 'heartbeats seen' : 'no heartbeat yet'}
            </Mono>
          ) : (
            <Absent>none open</Absent>
          )}
        </Row>
        <Row label="Heartbeats">
          {d.harnessHeartbeats ? 'proved for this harness' : <Absent>not yet proved</Absent>}
        </Row>
        <Row label="Waiting">
          <Mono>
            {e.approvals} approval{e.approvals === 1 ? '' : 's'}
            {e.question ? ' · a question' : ''}
          </Mono>
        </Row>
        <Row label="Seen">
          <Mono>
            {d.seenApprovals} approvals · {d.takenToolRequests} tool requests
          </Mono>
        </Row>
        {e.error && (
          <Row label="Error">
            <span className="wrap-anywhere text-state-failed">{e.error}</span>
          </Row>
        )}
      </dl>
    </li>
  );
}

/** One metered model call: when, which route priced as what, its tokens and its cost. */
function CallRow({ row: r }: { row: UsageEvent }) {
  const read = r.cache_read ?? 0;
  const write = r.cache_creation ?? 0;
  const prompt = (r.tokens_input ?? 0) + read + write;
  const tokens = prompt + (r.tokens_output ?? 0);
  const wire = r.wire_model_id && r.wire_model_id !== r.model_id ? r.wire_model_id : null;
  return (
    <li className="space-y-0.5 font-mono">
      <div className="flex flex-wrap gap-x-1.5">
        <span className="tabular-nums text-muted-foreground">{clockTime(tsToMs(r.ts))}</span>
        <span>{r.kind}</span>
        <span className="text-muted-foreground">·</span>
        <span className="wrap-anywhere">
          {r.model_id}
          {wire && <span className="text-muted-foreground"> priced as {wire}</span>}
        </span>
      </div>
      <div className="tabular-nums text-muted-foreground">
        {nf.format(prompt)} in ({nf.format(r.tokens_input ?? 0)} new · {nf.format(read)} read ·{' '}
        {nf.format(write)} write) · {nf.format(r.tokens_output ?? 0)} out ·{' '}
        {r.cost_usd === undefined ? (
          'no cost sent'
        ) : r.cost_usd === 0 && tokens > 0 ? (
          <span className="text-state-blocked">unpriced</span>
        ) : (
          `$${r.cost_usd.toFixed(5)}`
        )}
      </div>
    </li>
  );
}

/**
 * Copies the report. Markdown with one JSON block, because the place it goes is
 * an issue or a chat with whoever owns the harness: readable at the top, exact
 * underneath. The lease token is redacted — it authorises driving the thread — and
 * nothing else here is a credential.
 */
function CopyReport({ client, calls }: { client: ClientDiagnostics; calls: CallRows }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const id = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(id);
  }, [copied]);
  return (
    <Button
      size="sm"
      variant="outline"
      className="shrink-0 gap-1.5 text-xs"
      onClick={() => {
        const text = debugReport(client, calls);
        void navigator.clipboard?.writeText(text).then(
          () => setCopied(true),
          () => toast.error('Could not copy the report'),
        );
      }}
    >
      {copied ? <CheckIcon aria-hidden /> : <CopyIcon aria-hidden />}
      {copied ? 'Copied' : 'Copy report'}
    </Button>
  );
}

type CallRows = UsageEvent[] | 'unattributed';

/**
 * The thread's own calls. An older harness ignores `thread_id` and answers for
 * the tenant, so rows are filtered here too; one that sends no `thread_id` on any
 * row cannot attribute a call to a thread at all, and says so.
 */
export function threadCalls(items: UsageEvent[] | undefined, threadId: string): CallRows {
  if (!items) return [];
  if (items.length > 0 && items.every((r) => r.thread_id === undefined)) return 'unattributed';
  return items.filter((r) => r.thread_id !== undefined && threadSuffix(r.thread_id) === threadId);
}

/** The first four characters and the length: enough to match, not enough to use. */
export function redact(secret: string): string {
  return `${secret.slice(0, 4)}… (${secret.length} chars, redacted)`;
}

export function debugReport(
  client: ClientDiagnostics,
  calls: CallRows,
  where: { origin: string; userAgent: string } = {
    origin: typeof location === 'undefined' ? '' : location.origin,
    userAgent: typeof navigator === 'undefined' ? '' : navigator.userAgent,
  },
): string {
  const body = {
    ...client,
    at: new Date(client.at).toISOString(),
    origin: where.origin,
    userAgent: where.userAgent,
    lease: { ...client.lease, token: client.lease.token ? redact(client.lease.token) : null },
    calls:
      calls === 'unattributed'
        ? 'unattributed'
        : calls.map((r) => ({
            at: new Date(tsToMs(r.ts)).toISOString(),
            kind: r.kind,
            model: r.model_id,
            wireModel: r.wire_model_id ?? null,
            tokensInput: r.tokens_input,
            cacheRead: r.cache_read,
            cacheWrite: r.cache_creation,
            tokensOutput: r.tokens_output,
            costUsd: r.cost_usd ?? null,
          })),
  };
  const running = client.engines.filter((e) => e.streaming).length;
  const blocked = client.engines.filter((e) => e.approvals || e.question).length;
  return [
    '### Felix debug report',
    '',
    `- Thread \`${client.threadId}\` on \`${client.manifest}\`, ${client.turns} turns`,
    `- Lease: ${client.lease.mode ?? 'none'}${client.lease.heldByOther ? ' (another client drives)' : ''}`,
    `- Engines: ${client.engines.length} (${running} running, ${blocked} waiting on a person)`,
    `- Harness: ${client.harnessReachable ? 'answered the last request' : 'last request did not arrive'}`,
    '',
    '```json',
    JSON.stringify(body, null, 2),
    '```',
    '',
  ].join('\n');
}

function formatQuiet(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${Math.round(ms / 1000)}s`;
}

function Group({
  title,
  note,
  fields = true,
  children,
}: {
  title: string;
  note?: string;
  /** Children are `Row`s, laid out as one definition list. */
  fields?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold">{title}</h3>
        {note && <p className="text-muted-foreground">{note}</p>}
      </div>
      {fields ? (
        <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1">{children}</dl>
      ) : (
        children
      )}
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 wrap-anywhere">{children}</dd>
    </>
  );
}

function Mono({ children }: { children: React.ReactNode }) {
  return <span className="font-mono">{children}</span>;
}

/** A field the client does not have, said as such — never a zero or a blank. */
function Absent({ children }: { children: React.ReactNode }) {
  return <span className="text-muted-foreground italic">{children}</span>;
}
