import { Sheet, SheetContent, SheetTitle } from '@felix/ui/sheet';
import { useMemo } from 'react';
import { ApprovalBanner } from '@/components/chat/approval-banner';
import { contextFill } from '@/components/chat/context-meter';
import { Conversation } from '@/components/chat/conversation';
import { Greeting, useMountLabel } from '@/components/chat/greeting';
import { Message } from '@/components/chat/message';
import { MultimodalInput } from '@/components/chat/multimodal-input';
import { UiPromptBanner } from '@/components/chat/ui-prompt-banner';
import { Inspector } from '@/components/inspector/inspector';
import { RailPresence } from '@/components/rail-presence';
import { WorkspaceZone } from '@/components/workspace/workspace-zone';
import { INSTRUMENT_INLINE, WORKSPACE_INLINE } from '@/hooks/use-rails';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { DEFAULT_MANIFEST } from '@/lib/manifests';
import { cn } from '@/lib/utils';
import { useShell } from '@/shell-context';

/**
 * The narrow-width drawers' motion, at the inline rails' speed (`RAIL_MS`).
 * The primitive's own 500ms in / 300ms out, `ease-in-out`, made a zone that
 * snaps open at one width crawl open at another. `ease-out` because the drawer
 * answers a click: it should start fast and settle, not ramp up first.
 */
const DRAWER_MOTION =
  'ease-out data-[state=closed]:duration-200 data-[state=open]:duration-200 motion-reduce:animate-none';

/**
 * The workbench: the thread rail, the transcript and composer, and the
 * run-scoped inspector.
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
    submit,
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
    thinkingLevel,
    thinkingLevels,
    chooseThinking,
    verbose,
    harnessReachable,
    historyOpen,
    setHistoryOpen,
    inspectorOpen,
    setInspectorOpen,
  } = useShell();

  // Content-driven, not device-driven, and the order is the thesis.
  //
  // Three zones want 18rem + a ~560px reading column + 22rem, which is 1200px of
  // content before any chrome — so 1280 is where all three fit. Below it the
  // **instrument** yields first: it is reference material about the run, and the
  // half of it that cannot wait (an approval, a `ui_request`) is already in the
  // attention line and the banner above the composer, neither of which is in a
  // rail. Below 1024 the workspace follows, and the transcript takes the width.
  //
  // The workspace yields *last* of the two because it is the subject — the folder
  // is what the agent is working on, and the thread is how you talk to it. A rail
  // never narrows the thing it describes; it leaves.
  const instrumentInline = useMediaQuery(INSTRUMENT_INLINE);
  const workspaceInline = useMediaQuery(WORKSPACE_INLINE);

  const modelOptions = useMemo(() => {
    // The provider model is the one thing the harness says about a manifest
    // that its name does not: `cowork` and `cowork-fast` read the same until
    // one shows it runs on a different model. Order is the harness's, kept.
    const provider = new Map(manifestEntries.map((m) => [m.id, m.providerModel]));
    return manifestOptions.map((id) => ({ id, label: id, description: provider.get(id) }));
  }, [manifestOptions, manifestEntries]);

  const empty = turns.length === 0;

  // The window is the *selected* agent's, not the one the thread last ran on: the
  // next message goes to the selection, with this history replayed in front of it.
  const context = useMemo(
    () => contextFill(turns, manifestEntries.find((m) => m.id === manifest)?.contextWindow),
    [turns, manifestEntries, manifest],
  );

  // Which agent this thread's turns last ran on, for the line under the composer.
  // Only the local index knows (the harness keeps no manifest per thread), and a
  // thread with turns but no row there — first seen from another browser — is
  // `null`, said as unknown rather than filled in with the current selection.
  const threadAgent = empty
    ? undefined
    : (threads.find((t) => t.id === threadId)?.manifest ?? '').trim() || null;

  return (
    <>
      <div className="flex min-h-0 flex-1">
        {workspaceInline && (
          <RailPresence open={historyOpen} side="left">
            <WorkspaceZone />
          </RailPresence>
        )}
        <main className="bg-dots relative isolate flex min-w-0 flex-1 flex-col">
          <Conversation>
            {empty && <Greeting manifest={manifest} />}
            {turns.map((t, i) => {
              const isLast = i === turns.length - 1;
              return (
                <Message
                  key={t.id}
                  turn={t}
                  streaming={streaming && isLast}
                  verbose={verbose}
                  onRegenerate={isLast && t.role === 'assistant' ? regenerate : undefined}
                  onRewind={
                    !streaming && t.eventId && !isLast ? () => rewindTo(t.eventId!) : undefined
                  }
                  {...(!streaming && t.role === 'user' && (i > 0 || t.parentEventId)
                    ? { onEdit: (text: string) => void editTurn(t.id, text) }
                    : {})}
                  {...(t.eventId && labels[t.eventId] !== undefined
                    ? { label: labels[t.eventId] }
                    : {})}
                  {...(t.eventId ? { onLabel: (next) => labelTurn(t.eventId!, next) } : {})}
                />
              );
            })}
            {/* Neutral, not `running`: the run this names was torn down when the
                connection went, so painting it blue claimed the one thing the copy
                denies. Nor `failed` — nothing is broken and nobody is asked to act;
                the reattach is only collecting what already landed. */}
            {reattaching && (
              <div
                role="status"
                className="mx-auto max-w-2xl rounded-lg border border-border bg-solid-muted/60 px-3 py-2 text-sm text-foreground"
              >
                Connection dropped. That run was stopped — showing what it finished, and anything
                still landing on this thread.
              </div>
            )}
            {error && (
              <div
                role="alert"
                className="mx-auto max-w-2xl wrap-anywhere rounded-lg border border-state-failed/30 bg-solid-state-failed/10 px-3 py-2 text-sm text-state-failed"
              >
                {error}
              </div>
            )}
          </Conversation>
          <div
            className={cn(
              'border-t border-border/50 bg-background pt-3 transition-[background-color,border-color] duration-200 ease-out motion-reduce:transition-none',
              // Rising, the dock sits under the greeting rather than under a
              // transcript, so the rule and the slab that divide it from one go.
              empty && 'rise:border-transparent rise:bg-transparent',
            )}
          >
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
            <MultimodalInput
              status={streaming ? 'streaming' : 'ready'}
              reattaching={reattaching}
              isConnected={harnessReachable}
              onSubmit={submit}
              onBackground={(message) => submit(message, 'background')}
              onStop={stopRun}
              onSlashCommand={onSlashCommand}
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
              placeholder={
                streaming
                  ? 'Type to steer the run…'
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
        {instrumentInline && (
          <RailPresence open={inspectorOpen} side="right">
            <Inspector open={inspectorOpen} onClose={() => setInspectorOpen(false)} />
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
      {!workspaceInline && (
        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          {/* `data-shortcut-surface` names this drawer to the keyboard layer, so
              the binding that opened it may also close it while it holds focus. */}
          <SheetContent
            side="left"
            data-shortcut-surface="workspace"
            className={cn('w-[18rem] max-w-full gap-0 p-0 sm:max-w-none', DRAWER_MOTION)}
          >
            <SheetTitle className="sr-only">Workspace</SheetTitle>
            {/* The same zone, not a smaller stand-in: the threads popover, the
                mount controls and the tree all have to be reachable here or the
                narrow layout is missing a third of the app. The drawer supplies
                its own close button top-right, which the header pads around. */}
            <WorkspaceZone className="w-full border-r-0 bg-transparent [&>div:first-child]:pr-11" />
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
            <SheetTitle className="sr-only">This run</SheetTitle>
            <Inspector
              open={inspectorOpen}
              onClose={() => setInspectorOpen(false)}
              className="w-full border-l-0 bg-transparent"
            />
          </SheetContent>
        </Sheet>
      )}
    </>
  );
}
