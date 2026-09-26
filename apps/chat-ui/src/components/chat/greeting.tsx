import { useSyncExternalStore } from 'react';
import { getMountLabel } from '@/lib/cowork';
import { useShell } from '@/shell-context';

/**
 * The empty thread, as a readout of what the first message will be sent to.
 *
 * This was a 28px "What do you want to work on?" over four starter cards, one of
 * them a haiku — the consumer-chat empty state, and the only type on the surface
 * above the 14px title tier. What an operator needs from an empty thread is the
 * same thing they need from the rest of it: which agent, which folder, which
 * thread, and whether the harness is there to answer. So that is what it says,
 * and only what the client actually holds; a fact it would have to guess at
 * (the manifest's tool list, which is not fetched until a run reports it) is
 * left out rather than approximated.
 */
export function Greeting({ manifest }: { manifest: string }) {
  const { threadId, harnessReachable } = useShell();
  const folder = useMountLabel();

  return (
    // Anchored at the bottom, where the first turn will land, rather than centred:
    // the readout is read on the way to the composer, and nothing moves when the
    // thread gains its first message. `max-w-3xl` matches the transcript for the
    // same reason.
    <section
      aria-labelledby="empty-thread-title"
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col justify-end"
    >
      <div className="border-l border-border pl-3">
        <h2 id="empty-thread-title" className="text-sm font-semibold">
          Empty thread
        </h2>
        <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Agent</dt>
          <dd className="min-w-0 truncate font-mono">{manifest}</dd>
          <dt className="text-muted-foreground">Folder</dt>
          <dd className="min-w-0 truncate">
            {folder ? (
              <span className="font-mono">{folder}</span>
            ) : (
              <span className="text-muted-foreground">none mounted</span>
            )}
          </dd>
          <dt className="text-muted-foreground">Thread</dt>
          <dd className="min-w-0 truncate font-mono tabular-nums">{threadId}</dd>
          <dt className="text-muted-foreground">Harness</dt>
          <dd>
            {/* The word carries the state; the colour is the fast channel only. */}
            {harnessReachable ? (
              'reachable'
            ) : (
              <span className="text-state-failed">unreachable — a send will fail</span>
            )}
          </dd>
        </dl>
        {/* A sentence, so it is Body (13px) at a reading measure rather than the
            11px Label step the readout's rows use: it is read, not scanned. */}
        <p className="mt-3 max-w-[65ch] text-sm text-muted-foreground">
          The first message starts the run. Tool calls and approvals appear here as they happen.
        </p>
      </div>
    </section>
  );
}

/**
 * The mounted folder's name, kept current.
 *
 * The mount is module state in `@felix/cowork-client` with no change event, and
 * it moves while this is on screen: `restoreMount()` resolves after first paint,
 * and the workspace zone mounts and clears folders beside it. Read once, the
 * readout said "none mounted" beside a zone naming the folder. A one-second
 * re-read is a string comparison — React bails out when it has not changed —
 * and only runs while a thread is empty, which is the only time this renders.
 */
/** The mounted folder's name, or null. Polled: the mount has no change event. */
export function useMountLabel(): string | null {
  return useSyncExternalStore(subscribeMount, getMountLabel, () => null);
}

function subscribeMount(onChange: () => void): () => void {
  const id = window.setInterval(onChange, 1000);
  return () => window.clearInterval(id);
}
