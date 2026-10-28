import { lazy, type ReactNode, Suspense, useState, useSyncExternalStore } from 'react';
import { CutId } from '@/components/cut-id';
import { getSession, subscribeCredentials } from '@/lib/auth';
import { getMountLabel, supportsDirectoryPicker } from '@/lib/cowork';
import { mountFolder, reconnectFolder, useMount } from '@/lib/mount-state';
import { cn } from '@/lib/utils';
import { inBrowser, onHarness } from '@/lib/workspace-tools';
import { useShell } from '@/shell-context';
import { StarterPrompts } from './starter-prompts';

// Both are drawn only for a GitHub sign-in with an agent that works on the harness, so they
// load then: imported statically they put the repository picker and its file tree in every
// first load (~6 kB gzipped), for a line most empty threads never show.
const GreetingRepo = lazy(() =>
  import('@/components/workspace/thread-repo').then((m) => ({ default: m.GreetingRepo })),
);
const StartFromItem = lazy(() =>
  import('@/components/chat/start-from-item').then((m) => ({ default: m.StartFromItem })),
);

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
 *
 * Where the thread runs is also *chosen* here, because this is the one moment the
 * choice is cheap: before the first message. The Folder line mounts one (or
 * reconnects last session's), and an agent whose tools work on the harness gets a
 * Repository line that opens one of the person's repositories for this thread. The
 * line goes with the greeting at the first send; Files has the same controls after.
 */
export function Greeting({ manifest, blocked = false }: { manifest: string; blocked?: boolean }) {
  const { threadId, harnessReachable, manifestEntries } = useShell();
  const mount = useMount();
  // The polled label covers a mount made elsewhere; the store's is at once after a click here.
  const folder = useMountLabel() ?? mount.label;
  const canMount = supportsDirectoryPicker();
  // The repository opened from the readout below, which the starters gain a card for.
  const [repo, setRepo] = useState<string | null>(null);
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
                    mounted, so its file tools work in this tab&apos;s own storage
                    {canMount ? '; mount one below to work on yours.' : '.'}
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
          {repo && (
            <Suspense fallback={null}>
              <StartFromItem repo={repo} />
            </Suspense>
          )}
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
            <dd className="flex min-w-0 gap-1.5">
              {folder ? (
                <span className="truncate font-mono text-foreground">{folder}</span>
              ) : (
                <>
                  <span>none mounted</span>
                  {/* Each opens the browser's own prompt, which needs this click. A
                      browser without the directory picker offers neither: Files says
                      why, where there is room to. */}
                  {mount.reconnect ? (
                    <ReadoutAction onClick={() => void reconnectFolder()}>
                      Reconnect {mount.reconnect}
                    </ReadoutAction>
                  ) : canMount ? (
                    <ReadoutAction onClick={() => void mountFolder()}>Mount a folder</ReadoutAction>
                  ) : null}
                </>
              )}
            </dd>
          </div>
        ) : onHarness(tools) ? (
          <div className="flex min-w-0 gap-1.5">
            <dt>Files</dt>
            <dd>on the harness</dd>
          </div>
        ) : null}
        {onHarness(tools) && (
          // Its own component decides whether to draw: only for a GitHub sign-in.
          <RepositoryLine threadId={threadId} onRepo={setRepo} />
        )}
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

/** An action inside the readout: the line's own size and colour, marked by its underline. */
function ReadoutAction({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="shrink-0 rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:py-1"
    >
      {children}
    </button>
  );
}

/** The Repository line, only for a person whose sign-in can clone one. */
function RepositoryLine({
  threadId,
  onRepo,
}: {
  threadId: string;
  onRepo: (fullName: string | null) => void;
}) {
  const session = useSyncExternalStore(subscribeCredentials, getSession);
  if (!session?.login) return null;
  return (
    <div className="flex min-w-0 gap-1.5">
      <dt>Repository</dt>
      <dd className="flex min-w-0 gap-1.5">
        <Suspense fallback={null}>
          <GreetingRepo threadId={threadId} onRepo={onRepo} />
        </Suspense>
      </dd>
    </div>
  );
}
