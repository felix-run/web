/**
 * Rejoining a thread after the stream to it dropped.
 *
 * `POST /chat/stream` stamps `id:` on every structural frame — the thread's next
 * session sequence — and `GET /chat/stream/{thread_id}` takes the newest one
 * back as `Last-Event-ID`. Without this, a flaky connection or a refresh
 * mid-turn simply lost the turn: the reply stopped, and the only way to see what
 * the agent actually did was to reload the thread by hand.
 *
 * What this does NOT do is resume the run. A client that hangs up has its run
 * torn down deliberately, so it stops burning tokens. This rejoins the *thread*
 * — the work that already landed in the session log, plus whatever lands
 * afterwards (a durable run, a steer another tab queued, a tool result). The
 * distinction matters to the caller, which should say so rather than implying
 * the reply is still being written.
 */
import { getSessionSnapshot, resumeStream } from '@/api';
import type { SessionEvent, SessionSnapshot, StreamEvent, Turn } from '@/types';
import { eventsToTurns, snapshotToEvents } from './threads';

/**
 * Phases that mean the thread is still doing something, so a reattach that ends
 * should be retried. Anything else — `idle`, `aborted`, an unknown value from a
 * newer harness — ends the loop.
 */
const WORKING_PHASES = new Set(['turn', 'compaction', 'retry', 'branch_summary']);

/** Give up after this many reattaches, so a pathological thread cannot loop forever. */
const MAX_ATTEMPTS = 6;

export interface ReattachOptions {
  threadId: string;
  /** Newest `id:` from the lost stream. Omit for a cold reattach (full snapshot). */
  lastEventId?: string;
  signal?: AbortSignal;
  /** Replace the rendered transcript. Called whenever the thread's shape changes. */
  onTurns: (turns: Turn[]) => void;
  /** The thread's phase, as each reattach reports it. */
  onPhase?: (phase: string) => void;
  /**
   * Frames that are not `snapshot`/`session_event` — chiefly `on_error`, which
   * the reattach stream emits the same way any other stream does.
   */
  onEvent?: (event: StreamEvent) => void | Promise<void>;
  /** Injected so tests do not sleep. Defaults to setTimeout. */
  wait?: (ms: number) => Promise<void>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Reattach, and keep reattaching while the thread is still working.
 *
 * The harness closes an idle reattach after ~300s rather than holding the
 * connection open, and expects the client to come back with its cursor — so a
 * clean end is not evidence the thread is finished, and the phase has to be
 * checked separately.
 *
 * Resolves when the thread stops working, the attempt budget runs out, or the
 * signal aborts. Never throws for a failed reattach: the caller has already lost
 * one stream, and turning a failed *recovery* into the surfaced error would
 * replace a specific message with a generic one.
 */
export async function reattachThread(opts: ReattachOptions): Promise<void> {
  const wait = opts.wait ?? sleep;
  let cursor = opts.lastEventId;

  // Session events seen since the last snapshot. Held as a list and re-folded
  // rather than patched in place, so `eventsToTurns` stays the single definition
  // of how events become turns — the same one thread hydration uses.
  let base: SessionEvent[] = [];
  let seenSnapshot = false;

  const render = () => {
    if (!base.length) return;
    const turns = eventsToTurns(base);
    if (turns.length) opts.onTurns(turns);
  };

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    if (opts.signal?.aborted) return;

    try {
      await resumeStream(
        { threadId: opts.threadId, lastEventId: cursor, signal: opts.signal },
        {
          onCursor: (id) => {
            cursor = id;
          },
          onEvent: async (ev) => {
            if (ev.event === 'snapshot') {
              const snap = ev.data as SessionSnapshot;
              // Authoritative: it already accounts for the active branch, so a
              // rewind that happened while we were away is reflected rather than
              // merged on top of a stale list.
              base = snapshotToEvents(snap);
              seenSnapshot = true;
              if (snap.phase) opts.onPhase?.(snap.phase);
              render();
              return;
            }
            if (ev.event === 'session_event') {
              const row = ev.data as SessionEvent;
              // A warm reattach replays only what was missed, so without a
              // snapshot underneath there is nothing to fold these into — the
              // caller's existing transcript stays as it is until the next cold
              // reattach rebuilds it.
              if (!seenSnapshot) return;
              if (typeof row?.seq !== 'number') return;
              if (!base.some((e) => e.seq === row.seq)) {
                base = [...base, row];
                render();
              }
              return;
            }
            await opts.onEvent?.(ev);
          },
        },
      );
    } catch {
      // A failed reattach is not worth surfacing on its own; the phase check
      // below decides whether it is worth another try.
    }

    if (opts.signal?.aborted) return;

    const snap = await getSessionSnapshot(opts.threadId).catch(() => null);
    const phase = snap?.phase ?? '';
    if (phase) opts.onPhase?.(phase);
    if (!WORKING_PHASES.has(phase)) return;

    // The next attempt is a cold one if we never got a usable cursor, so it
    // rebuilds from a snapshot rather than asking to replay from nothing.
    await wait(Math.min(1000 * 2 ** attempt, 15_000));
  }
}
