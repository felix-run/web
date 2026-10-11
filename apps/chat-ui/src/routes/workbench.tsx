import { Marker, MarkerContent, MarkerIcon } from '@felix/ui/marker';
import { Sheet, SheetContent, SheetTitle } from '@felix/ui/sheet';
import { LogOutIcon, UnplugIcon } from 'lucide-react';
import { lazy, Suspense, useEffect, useMemo, useRef } from 'react';
import { useInRouterContext, useSearchParams } from 'react-router';
import { ApprovalBanner } from '@/components/chat/approval-banner';
import { contextFill, NEARLY_FULL } from '@/components/chat/context-meter';
import { Conversation, ConversationItem } from '@/components/chat/conversation';
import { DenialsSync } from '@/components/chat/denials-sync';
import { Greeting, useMountLabel } from '@/components/chat/greeting';
import { InstallHint } from '@/components/chat/install-hint';
import { Message } from '@/components/chat/message';
import { MultimodalInput } from '@/components/chat/multimodal-input';
import { PushHint } from '@/components/chat/push-hint';
import { TurnCheckpoint } from '@/components/chat/turn-checkpoint';
import { UiPromptBanner } from '@/components/chat/ui-prompt-banner';
import { WATCHING_REFUSAL, WatchingBanner } from '@/components/chat/watching-banner';
import { PaneDivider } from '@/components/pane/pane-divider';
import { usePaneLayout } from '@/components/pane/use-pane-layout';
import { RailPresence } from '@/components/rail-presence';
import { INSTRUMENT_INLINE } from '@/hooks/use-rails';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { landedPaths } from '@/lib/changes';
import { DEFAULT_MANIFEST } from '@/lib/manifests';
import { openInPane, setPaneShown, usePaneState } from '@/lib/side-pane';
import { cn } from '@/lib/utils';
import { useShell } from '@/shell-context';

/**
 * The run instrument loads with its first showing, not with the app. Below 1280
 * it is a drawer most visits never open, and its sections — plans, tool metrics
 * and the primitives they draw with — were a block of the entry chunk every one
 * of those visits paid for.
 */
const Inspector = lazy(() =>
  import('@/components/inspector/inspector').then((m) => ({ default: m.Inspector })),
);

/** The side pane loads with the first thing opened in it. */
const SidePane = lazy(() =>
  import('@/components/pane/side-pane').then((m) => ({ default: m.SidePane })),
);

/**
 * The instrument's footprint while it loads: the same column, empty, so the
 * transcript does not reflow when the panel arrives a moment later.
 */
function InspectorLoading({ className }: { className?: string }) {
  return (
    <div
      role="status"
      aria-label="Loading this thread"
      className={cn(
        'h-full w-[clamp(22rem,24vw,30rem)] shrink-0 border-l border-border/60 bg-solid-card/40',
        className,
      )}
    />
  );
}

/**
 * The narrow-width drawers' motion, at the inline rails' speed (`RAIL_MS`).
 * The primitive's own 500ms in / 300ms out, `ease-in-out`, made a zone that
 * snaps open at one width crawl open at another. `ease-out` because the drawer
 * answers a click: it should start fast and settle, not ramp up first.
 */
const DRAWER_MOTION =
  'ease-out data-[state=closed]:duration-200 data-[state=open]:duration-200 motion-reduce:animate-none';

/**
 * The workbench: the transcript and composer, and the run-scoped inspector. The
 * sidebar to its left belongs to the shell, because it is the same on `/harness`.
 *
 * Everything here is a view onto state the root layout owns — the engine, the
 * thread and the approval queue outlive this route, which is the whole point of
 * the split. Visiting a second top-level address must not unmount a live run.
 */
export function Workbench() {
  // "Workspace goal" promises a folder; with none mounted the composer says what it is.
  const mountedFolder = useMountLabel();
  const {
    turns,
    streaming,
    reattaching,
    leftApp,
    dropped,
    error,
    sessionPhase,
    pending,
    queueLength,
    onDecide,
    onDismiss,
    uiPrompt,
    uiResolving,
    onUiRespond,
    onUiCancel,
    labels,
    labelTurn,
    branches,
    switchBranch,
    feedback,
    rateTurn,
    submit,
    kept,
    takeKept,
    draftMessage,
    queue,
    steerQueued,
    stopRun,
    regenerate,
    rewindTo,
    editTurn,
    onSlashCommand,
    manifest,
    setManifest,
    manifestOptions,
    manifestEntries,
    threads,
    threadId,
    watching,
    driver,
    thinkingLevel,
    thinkingLevels,
    chooseThinking,
    permissionMode,
    choosePermissionMode,
    outputStyle,
    chooseOutputStyle,
    debug,
    harnessReachable,
    inspectorOpen,
    setInspectorOpen,
  } = useShell();

  // Content-driven, not device-driven, and the order is the thesis.
  //
  // The sidebar (17rem), a ~560px reading column and the instrument (22rem) want
  // 1200px of content before any chrome — so 1280 is where all three fit. Below
  // it the **instrument** yields first: it is reference material about the run,
  // and the half of it that cannot wait (an approval, a `ui_request`) is already
  // in the attention line and the banner above the composer, neither of which is
  // in a rail. Below 1024 the sidebar follows, as a drawer, and the transcript
  // takes the width. The sidebar yields last because it holds every way to
  // anywhere else — threads, the workspace, the harness.
  const instrumentInline = useMediaQuery(INSTRUMENT_INLINE);

  const modelOptions = useMemo(() => {
    // The provider model is the one thing the harness says about a manifest
    // that its name does not: `cowork` and `cowork-fast` read the same until
    // one shows it runs on a different model. Order is the harness's, kept.
    const provider = new Map(manifestEntries.map((m) => [m.id, m.providerModel]));
    return manifestOptions.map((id) => ({ id, label: id, description: provider.get(id) }));
  }, [manifestOptions, manifestEntries]);

  const empty = turns.length === 0;
  /**
   * The driving actions, off while another client drives this thread. Rating a
   * reply stays: the harness lets an observer give one, since it writes no turn.
   */
  const drives = !watching;
  // Rows are named by position (see `Conversation`), so the anchor is too.
  const lastUser = turns.map((t) => t.role).lastIndexOf('user');
  const lastAnchorId = lastUser === -1 ? undefined : `turn-${lastUser}`;

  // The window is the *selected* agent's, not the one the thread last ran on: the
  // next message goes to the selection, with this history replayed in front of it.
  const fill = useMemo(
    () => contextFill(turns, manifestEntries.find((m) => m.id === manifest)?.contextWindow),
    [turns, manifestEntries, manifest],
  );
  // The selected agent's own `/name` commands, expanded by the harness.
  const agentCommands = useMemo(
    () => manifestEntries.find((m) => m.id === manifest)?.commands,
    [manifestEntries, manifest],
  );
  // The meter is debug's — except a window nearly full, which is about to change
  // what the agent can see, and so is the daily user's to know too.
  const context = debug || (fill && fill.share >= NEARLY_FULL) ? fill : null;
  // The selected agent's styles. A stored name it does not declare reads as its default,
  // which is what the harness runs, so the picker says Default rather than a stale name.
  const agentEntry = manifestEntries.find((m) => m.id === manifest);
  const outputStyles = agentEntry?.outputStyles;
  const shownStyle =
    outputStyle && outputStyles?.some((st) => st.name.toLowerCase() === outputStyle.toLowerCase())
      ? outputStyle
      : null;

  // Which agent this thread's turns last ran on, for the line under the composer.
  // Only the local index knows (the harness keeps no manifest per thread), and a
  // thread with turns but no row there — first seen from another browser — is
  // `null`, said as unknown rather than filled in with the current selection.
  const threadAgent = empty
    ? undefined
    : (threads.find((t) => t.id === threadId)?.manifest ?? '').trim() || null;

  // The side pane. Where the instrument is a column it takes the instrument's
  // place (the shell hands the zone over: `app-shell.tsx`); below that it sits
  // beside the transcript wherever both fit their floors, and over the sheet
  // where they do not (`usePaneLayout`). It is the daily surface's, not debug's:
  // reading what the agent wrote is the outcome, not the mechanism.
  const row = useRef<HTMLDivElement>(null);
  const layout = usePaneLayout(row);
  const pane = usePaneState(threadId);
  const paneOpen = pane.shown && pane.items.length > 0;
  const changedPaths = useMemo(() => landedPaths(turns), [turns]);
  const runPaths = useMemo(
    () => (streaming && lastUser !== -1 ? landedPaths(turns, lastUser) : new Set<string>()),
    [turns, streaming, lastUser],
  );
  const inRouter = useInRouterContext();
  const sidePane = (onBack?: () => void) => (
    <Suspense fallback={null}>
      <SidePane
        threadId={threadId}
        changedPaths={changedPaths}
        runPaths={runPaths}
        streaming={streaming}
        {...(onBack ? { onBack } : {})}
      />
    </Suspense>
  );

  return (
    <>
      {inRouter && <OpenLink threadId={threadId} items={pane.items} active={pane.active} />}
      <div ref={row} className="flex min-h-0 flex-1">
        <main className="relative isolate flex min-w-0 flex-1 flex-col">
          {/* Who denied each denied call and when, and its "Ask again" — offered only
              to a tab that drives the thread, since it fills this tab's composer. */}
          <DenialsSync
            threadId={threadId}
            turns={turns}
            {...(drives ? { onAskAgain: draftMessage } : {})}
          />
          <Conversation lastAnchorId={lastAnchorId}>
            {empty && (
              // Not a row: the scroller applies its opening position when rows first
              // appear, and a greeting counted as one made a thread's turns arrive as
              // "new" (see `Conversation`).
              <div className="flex flex-1 flex-col">
                <Greeting manifest={manifest} blocked={pending != null || uiPrompt != null} />
              </div>
            )}
            {turns.map((t, i) => {
              const isLast = i === turns.length - 1;
              return (
                // The row is keyed by position and the message by turn: the scroller
                // remembers which anchors it has handled by DOM element, so a
                // snapshot rebuild that re-mints turn ids must not re-create the
                // rows, or every anchor reads as new and the view jumps to the first.
                <ConversationItem key={`turn-${i}`} id={`turn-${i}`} anchor={t.role === 'user'}>
                  <Message
                    key={t.id}
                    turn={t}
                    streaming={streaming && isLast}
                    {...(t.eventId && branches?.has(t.eventId)
                      ? { branch: branches.get(t.eventId) }
                      : {})}
                    {...(drives && !streaming && switchBranch
                      ? { onSwitchBranch: switchBranch }
                      : {})}
                    verbose={debug}
                    debug={debug}
                    onRegenerate={
                      drives && isLast && t.role === 'assistant' ? regenerate : undefined
                    }
                    onRewind={
                      drives && !streaming && t.eventId && !isLast
                        ? () => rewindTo(t.eventId!)
                        : undefined
                    }
                    {...(drives && !streaming && t.role === 'user' && (i > 0 || t.parentEventId)
                      ? { onEdit: (text: string) => void editTurn(t.id, text) }
                      : {})}
                    {...(t.eventId && labels[t.eventId] !== undefined
                      ? { label: labels[t.eventId] }
                      : {})}
                    {...(drives && t.eventId
                      ? { onLabel: (next) => labelTurn(t.eventId!, next) }
                      : {})}
                    {...(t.role === 'assistant' && !(streaming && isLast)
                      ? {
                          onRate: (
                            rating: 'up' | 'down' | null,
                            opts?: { note?: string; evalDataset?: string },
                          ) => void rateTurn(t.id, rating, opts),
                          ...(t.eventId && feedback[t.eventId]
                            ? { feedback: feedback[t.eventId] }
                            : {}),
                        }
                      : {})}
                  />
                  {/* A labelled turn is a restore point, so it says so where it is
                      rather than only in the hover-revealed actions. */}
                  {drives &&
                    t.eventId &&
                    labels[t.eventId] !== undefined &&
                    !streaming &&
                    !isLast && (
                      <TurnCheckpoint
                        label={labels[t.eventId] as string}
                        onRestore={() => rewindTo(t.eventId as string)}
                      />
                    )}
                </ConversationItem>
              );
            })}
            {/* Neutral, not `running`: the run this names was torn down when the
                connection went, so painting it blue claimed the one thing the copy
                denies. Nor `failed` — nothing is broken and nobody is asked to act;
                the reattach is only collecting what already landed. */}
            {/* When the drop came from leaving the page — on a phone, switching
                apps — say that, because it is the one cause the operator can
                avoid next time, and say how. It outlives the reattach, which
                takes a moment that person was not looking at. */}
            {(reattaching || leftApp || dropped) && (
              <ConversationItem id="reattach">
                {/* A marker, not a card: it is a note about the run, in the
                    transcript's own voice, and nobody is being asked to act on it.
                    The word that matters is "stopped", so it leads. */}
                <Marker role="status" variant="border">
                  <MarkerIcon>{leftApp ? <LogOutIcon /> : <UnplugIcon />}</MarkerIcon>
                  <MarkerContent>
                    {leftApp ? (
                      <>
                        Leaving the page stopped that run — showing what it finished. To keep one
                        going while you are away, send it with Run in background.
                      </>
                    ) : (
                      <>
                        Connection dropped. That run was stopped — showing what it finished
                        {reattaching ? (
                          <>
                            , and{' '}
                            <span className="shimmer shimmer-color-foreground">
                              anything still landing on this thread
                            </span>
                            .
                          </>
                        ) : (
                          '. Nothing more is coming for it; send again to retry.'
                        )}
                      </>
                    )}
                  </MarkerContent>
                </Marker>
              </ConversationItem>
            )}
            {error && (
              <ConversationItem id="error">
                <div
                  role="alert"
                  className="mx-auto max-w-2xl wrap-anywhere rounded-lg border border-state-failed/30 bg-solid-state-failed/10 px-3 py-2 text-sm text-state-failed"
                >
                  {error}
                </div>
              </ConversationItem>
            )}
          </Conversation>
          <div
            className={cn(
              // No rule above the dock: on the sheet the composer's own lift is the edge.
              'bg-background pt-3 transition-[background-color] duration-200 ease-out motion-reduce:transition-none',
              // Rising, the dock sits under the greeting rather than under a
              // transcript, so the rule and the slab that divide it from one go.
              empty && 'rise:bg-transparent',
            )}
          >
            {watching ? <WatchingBanner driver={driver} /> : null}
            {pending ? (
              <ApprovalBanner
                pending={pending}
                queueLength={queueLength}
                runAborted={sessionPhase === 'aborted'}
                onDecide={onDecide}
                onDismiss={onDismiss}
              />
            ) : null}
            {uiPrompt ? (
              <UiPromptBanner
                pending={uiPrompt}
                resolving={uiResolving}
                onRespond={(value) => void onUiRespond(value)}
                onCancel={() => void onUiCancel()}
              />
            ) : null}
            {!empty && <InstallHint />}
            {!empty && <PushHint />}
            <MultimodalInput
              status={streaming ? 'streaming' : 'ready'}
              reattaching={reattaching}
              readOnly={watching ? WATCHING_REFUSAL : null}
              isConnected={harnessReachable}
              onSubmit={submit}
              queue={queue}
              onSteerQueued={steerQueued}
              kept={kept}
              onKeptTaken={takeKept}
              onBackground={(message) => submit(message, 'background')}
              onStop={stopRun}
              onSlashCommand={onSlashCommand}
              agentCommands={agentCommands}
              models={modelOptions}
              modelId={manifest}
              onModelChange={setManifest}
              threadAgent={threadAgent}
              context={context}
              thinkingLevels={thinkingLevels}
              thinkingLevel={thinkingLevel}
              onThinkingChange={(level) => {
                // Narrowed back from the picker's string rather than cast: the
                // picker only offers these, and a value that is not one is dropped.
                const known = thinkingLevels.find((l) => l === level);
                if (known) chooseThinking(known);
              }}
              permissionMode={permissionMode}
              onLeavePermissionMode={() => choosePermissionMode('default')}
              {...(outputStyles?.length
                ? {
                    outputStyles,
                    outputStyle: shownStyle,
                    defaultOutputStyle: agentEntry?.defaultOutputStyle ?? null,
                    onOutputStyleChange: chooseOutputStyle,
                  }
                : {})}
              placeholder={
                streaming
                  ? 'Write the next message…'
                  : manifest === DEFAULT_MANIFEST && mountedFolder
                    ? 'Describe a workspace goal…'
                    : 'Message Felix…'
              }
            />
          </div>
          {/* What lifts the composer on an empty thread: a track under the dock
              that takes a third of the free height, so the greeting (pinned to the
              bottom of the transcript) and the composer read as one block just
              above centre. The first message collapses it, and the composer
              settles to the bottom at the zones' 200ms rather than jumping half a
              screen — the same element throughout, so focus and a half-typed
              draft survive the move. */}
          <div
            aria-hidden
            className={cn(
              'shrink-0 grow-0 basis-0 transition-[flex-grow] duration-200 ease-out motion-reduce:transition-none',
              empty && 'rise:grow-[0.5]',
            )}
          />
        </main>
        {paneOpen && layout.split && (
          <>
            <PaneDivider
              share={layout.share}
              min={layout.min}
              max={layout.max}
              onChange={layout.onChange}
              onCommit={layout.onCommit}
              onReset={layout.onReset}
              controls="side-pane"
            />
            <div
              id="side-pane"
              style={{ width: `${(layout.share * 100).toFixed(2)}%` }}
              className="flex min-h-0 shrink-0 animate-in fade-in-0 slide-in-from-right-3 duration-200 ease-out motion-reduce:animate-none"
            >
              {sidePane()}
            </div>
          </>
        )}
        {instrumentInline && (
          <RailPresence open={inspectorOpen} side="right">
            <Suspense fallback={<InspectorLoading />}>
              <Inspector open={inspectorOpen} onClose={() => setInspectorOpen(false)} />
            </Suspense>
          </RailPresence>
        )}
      </div>

      {/* Below their breakpoints the same zones become overlays — the same
        components and the same toggle state, so the header buttons keep working
        and nothing is reachable in one layout but missing in the other. The
        *state* differs underneath: `historyOpen`/`inspectorOpen` report what is on
        screen, and at these widths that is an unpersisted drawer, never the stored
        rail preference (`hooks/use-rails.ts`).

        Each width is capped at the viewport by `max-w-full`. The primitive's own
        cap is `sm:`-only, and `sm:max-w-none` below lifts even that, so under 640px
        a fixed rem width is the whole story: the instrument's 22rem is 352px, and
        on a 320px phone it hung 32px off the left edge — its title, its first tab
        and the start of every row cut away, measured in a real browser. */}
      {!layout.split && (
        <Sheet
          open={paneOpen}
          onOpenChange={(open) => {
            if (!open) setPaneShown(threadId, false);
          }}
        >
          <SheetContent
            side="right"
            showCloseButton={false}
            data-shortcut-surface="pane"
            className={cn('w-full max-w-full gap-0 p-0 sm:max-w-none', DRAWER_MOTION)}
          >
            <SheetTitle className="sr-only">Side pane</SheetTitle>
            {sidePane(() => setPaneShown(threadId, false))}
          </SheetContent>
        </Sheet>
      )}

      {!instrumentInline && (
        <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
          <SheetContent
            side="right"
            showCloseButton={false}
            data-shortcut-surface="instrument"
            className={cn('w-[22rem] max-w-full gap-0 p-0 sm:max-w-none', DRAWER_MOTION)}
          >
            {/* The dialog's name is the heading it shows. It read "Harness
                inspector" — a name for a panel that no longer exists, announced
                over a heading that says something else. */}
            <SheetTitle className="sr-only">This thread</SheetTitle>
            <Suspense fallback={<InspectorLoading className="w-full border-l-0 bg-transparent" />}>
              <Inspector
                open={inspectorOpen}
                onClose={() => setInspectorOpen(false)}
                className="w-full border-l-0 bg-transparent"
              />
            </Suspense>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}

/**
 * The open file in the address — `?open=path/in/workspace` — so a reload, or a
 * link, lands on it. Only a workspace file: it is the one item an address can
 * name and the pane re-read; an output, a code block or an image is content the
 * pane was handed, which this tab's session storage already brings back.
 */
function OpenLink({
  threadId,
  items,
  active,
}: {
  threadId: string;
  items: readonly { key: string }[];
  active: string | null;
}) {
  const [params, setParams] = useSearchParams();
  const asked = params.get('open');

  // Arriving with a file named: open it, once per thread.
  const opened = useRef<string | null>(null);
  useEffect(() => {
    if (!asked || opened.current === `${threadId}\n${asked}`) return;
    opened.current = `${threadId}\n${asked}`;
    openInPane(threadId, { kind: 'file', path: asked.replace(/^\/+/, '') });
  }, [threadId, asked]);

  const linked =
    active?.startsWith('file:') && items.some((i) => i.key === active)
      ? active.slice('file:'.length)
      : null;
  useEffect(() => {
    if (linked === asked) return;
    // Until the asked-for file has been opened, the address is the request, not a stale echo.
    if (asked && opened.current !== `${threadId}\n${asked}`) return;
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (linked) next.set('open', linked);
        else next.delete('open');
        return next;
      },
      { replace: true },
    );
  }, [linked, asked, threadId, setParams]);
  return null;
}
