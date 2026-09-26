import { Sheet, SheetContent, SheetTitle } from '@felix/ui/sheet';
import { useMemo } from 'react';
import { ApprovalBanner } from '@/components/chat/approval-banner';
import { Conversation } from '@/components/chat/conversation';
import { Greeting } from '@/components/chat/greeting';
import { Message } from '@/components/chat/message';
import { MultimodalInput } from '@/components/chat/multimodal-input';
import { UiPromptBanner } from '@/components/chat/ui-prompt-banner';
import { Inspector } from '@/components/inspector/inspector';
import { WorkspaceZone } from '@/components/workspace/workspace-zone';
import { INSTRUMENT_INLINE, WORKSPACE_INLINE } from '@/hooks/use-rails';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { DEFAULT_MANIFEST } from '@/lib/manifests';
import { useShell } from '@/shell-context';

/**
 * The workbench: the thread rail, the transcript and composer, and the
 * run-scoped inspector.
 *
 * Everything here is a view onto state the root layout owns — the engine, the
 * thread and the approval queue outlive this route, which is the whole point of
 * the split. Visiting a second top-level address must not unmount a live run.
 */
export function Workbench() {
  const {
    turns,
    streaming,
    reattaching,
    error,
    sessionPhase,
    pending,
    queueLength,
    onDecide,
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
    onSlashCommand,
    manifest,
    setManifest,
    manifestOptions,
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

  const modelOptions = useMemo(
    () => manifestOptions.map((id) => ({ id, label: id })),
    [manifestOptions],
  );

  return (
    <>
      <div className="flex min-h-0 flex-1">
        {historyOpen && workspaceInline && <WorkspaceZone />}
        <main className="flex min-w-0 flex-1 flex-col">
          <Conversation>
            {turns.length === 0 && <Greeting manifest={manifest} />}
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
                className="mx-auto max-w-2xl rounded-lg border border-border bg-muted/60 px-3 py-2 text-sm text-foreground"
              >
                Connection dropped. That run was stopped — showing what it finished, and anything
                still landing on this thread.
              </div>
            )}
            {error && (
              <div
                role="alert"
                className="mx-auto max-w-2xl rounded-lg border border-state-failed/30 bg-state-failed/10 px-3 py-2 text-sm text-state-failed"
              >
                {error}
              </div>
            )}
          </Conversation>
          <div className="border-t border-border/50 bg-background/80 pt-3 backdrop-blur-sm">
            {pending ? (
              <ApprovalBanner
                pending={pending}
                queueLength={queueLength}
                runAborted={sessionPhase === 'aborted'}
                onDecide={onDecide}
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
              placeholder={
                streaming
                  ? 'Type to steer the run…'
                  : manifest === DEFAULT_MANIFEST
                    ? 'Describe a workspace goal…'
                    : 'Message Felix…'
              }
            />
          </div>
        </main>
        {inspectorOpen && instrumentInline && (
          <Inspector open={inspectorOpen} onClose={() => setInspectorOpen(false)} />
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
            className="w-[18rem] max-w-full gap-0 p-0 sm:max-w-none"
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
            className="w-[22rem] max-w-full gap-0 p-0 sm:max-w-none"
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
