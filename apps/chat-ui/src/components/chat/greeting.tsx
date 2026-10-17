import { useSyncExternalStore } from 'react';
import { CutId } from '@/components/cut-id';
import { getMountLabel } from '@/lib/cowork';
import { cn } from '@/lib/utils';
import { inBrowser, onHarness } from '@/lib/workspace-tools';
import { useShell } from '@/shell-context';
import { StarterPrompts } from './starter-prompts';

/**
 * The empty thread: a welcome, the agent's starter prompts, and a readout of
 * what the first message will be sent to.
 *
 * The welcome headline and the starter-card grid were removed on 2026-09-26 in
 * favour of the readout alone, and came back on purpose: an empty thread that
 * only listed facts left a new operator guessing what to ask. The readout stays,
 * demoted to one quiet line under the cards, because "harness unreachable" is
 * the one fact here that changes what to do next and has to stay visible.
 *
 * Only what the client holds is read out; a fact it would have to guess at (the
 * manifest's tool list, which is not fetched until a run reports it) is left out
 * rather than approximated.
 */
export function Greeting({ manifest, blocked = false }: { manifest: string; blocked?: boolean }) {
  const { threadId, harnessReachable, manifestEntries } = useShell();
  const folder = useMountLabel();
  // The manifest's own words, when it has them (`metadata.greeting`); each half
  // falls back on its own, so a manifest can change the headline and keep the
  // sentence that names the agent.
  const entry = manifestEntries.find((m) => m.id === manifest);
  // Where this agent's file tools work. The folder is the browser's, so it is
  // named only for an agent that works there; an agent with none has no
  // workspace to read out, and "none mounted" beside it read as something to fix.
  const tools = entry?.workspace?.tools;
  // An agent whose tools work in the browser writes its greeting for its folder
  // ("What should we do in this folder?"), and with none mounted that headline sat
  // over a readout saying "none mounted" (2026-10-16). The manifest has no second
  // greeting for that case, so the client's own copy stands in until a folder is
  // mounted, and says where the tools work meanwhile. The starters stay.
  const unmounted = inBrowser(tools) && !folder;
  const greeting = unmounted ? undefined : entry?.greeting;

  return (
    // `flex-1` + `justify-center`: the greeting is the only child of the transcript
    // column when a thread is empty, so it centres in the height actually available.
    // Where the composer rises to meet it (`rise`, see the workbench), it sits on
    // the column's floor instead, directly above the composer.
    // `max-w-3xl` matches the transcript and composer, so nothing shifts sideways
    // when the first message replaces it.
    <section
      // Blocked, the heading is not drawn, so the region names itself.
      aria-labelledby={blocked ? undefined : 'empty-thread-title'}
      aria-label={blocked ? 'Empty thread' : undefined}
      className={cn(
        'mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 py-4',
        // Blocked, the readout alone sits on the floor beside the banner rather
        // than floating mid-column with nothing above it.
        blocked ? 'justify-end' : 'justify-center rise:justify-end',
      )}
    >
      {/* Not while this thread is waiting on you. An empty thread with a call
          blocked on it is not one asking what to work on — the approval above
          the composer is the work, and a headline and four starters above it
          put an invitation between the operator and the decision. The readout
          stays: it is facts, not an invitation. It returns once the call is
          answered. */}
      {!blocked && (
        <>
          <div className="flex flex-col gap-2">
            <h2
              id="empty-thread-title"
              className="text-balance text-2xl font-semibold tracking-tight md:text-[1.75rem]"
            >
              {greeting?.headline ?? 'What do you want to work on?'}
            </h2>
            {/* 32rem at 16px holds ~70 characters; `max-w-prose` (65ch) measured ~86 here,
                past the 65–75 a paragraph reads comfortably at. */}
            <p className="max-w-[32rem] text-pretty text-base text-muted-foreground">
              {greeting?.subtitle ??
                (unmounted && entry?.greeting ? (
                  <>
                    You&apos;re chatting with{' '}
                    <span className="font-medium text-foreground">{manifest}</span>. No folder is
                    mounted, so its file tools work in this tab&apos;s own storage; mount one from
                    Workspace in the sidebar to work on yours.
                  </>
                ) : (
                  <>
                    You&apos;re chatting with{' '}
                    <span className="font-medium text-foreground">{manifest}</span>. Pick a starter
                    or type below; you can switch agents anytime from the composer.
                  </>
                ))}
            </p>
          </div>

          <StarterPrompts manifest={manifest} />
        </>
      )}

      {/* The readout, as one line. A `dl` still, so each value keeps its name for a
          screen reader; laid out inline so it reads as a footnote, not a panel. */}
      <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <div className="flex min-w-0 gap-1.5">
          <dt>Agent</dt>
          <dd className="truncate font-mono text-foreground">{manifest}</dd>
        </div>
        {inBrowser(tools) ? (
          <div className="flex min-w-0 gap-1.5">
            <dt>Folder</dt>
            <dd className="truncate">
              {folder ? (
                <span className="font-mono text-foreground">{folder}</span>
              ) : (
                'none mounted'
              )}
            </dd>
          </div>
        ) : onHarness(tools) ? (
          <div className="flex min-w-0 gap-1.5">
            <dt>Files</dt>
            <dd>on the harness</dd>
          </div>
        ) : null}
        <div className="flex min-w-0 gap-1.5">
          <dt>Thread</dt>
          {/* Cut from the middle, like every id that tells rows apart: the tail
              is what distinguishes one thread from another. */}
          <dd className="font-mono tabular-nums" title={threadId}>
            <CutId id={threadId} max={14} />
          </dd>
        </div>
        <div className="flex min-w-0 gap-1.5">
          <dt>Harness</dt>
          <dd>
            {/* The word carries the state; the colour is the fast channel only. */}
            {harnessReachable ? (
              'reachable'
            ) : (
              <span className="text-state-failed">unreachable — a send will fail</span>
            )}
          </dd>
        </div>
      </dl>
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
