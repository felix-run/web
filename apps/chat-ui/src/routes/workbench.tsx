import { Sheet, SheetContent, SheetTitle } from '@felix/ui/sheet';
import { useMemo } from 'react';
import { ApprovalBanner } from '@/components/chat/approval-banner';
import { Conversation } from '@/components/chat/conversation';
import { Greeting } from '@/components/chat/greeting';
import { Message } from '@/components/chat/message';
import { MultimodalInput } from '@/components/chat/multimodal-input';
import { ThreadList } from '@/components/chat/thread-list';
import { UiPromptBanner } from '@/components/chat/ui-prompt-banner';
import { WorkspaceStrip } from '@/components/chat/workspace-strip';
import { Inspector } from '@/components/inspector/inspector';
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
    threadId,
    labels,
    labelTurn,
    send,
    submit,
    stopRun,
    regenerate,
    rewindTo,
    onSlashCommand,
    threads,
    selectThread,
    newThread,
    deleteThread,
    renameThread,
    forkThread,
    compactThread,
    exportThread,
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

  // Content-driven, not device-driven. The chat column wants ~560px before the
  // transcript and composer start to feel cramped, and the two rails cost 592px of
  // chrome, so both fit inline down to 1152. Below that the inspector becomes a
  // drawer, which buys the chat back to ~790px; below 1024 the history rail follows
  // and the transcript gets the full width. Neither rail ever squeezes the chat
  // instead of yielding, which is what the old fixed-width flex row did all the way
  // down to a 168px transcript.
  //
  // The inspector is kept inline as long as it fits rather than switching at a round
  // number: it is a reference panel read *beside* the chat, and a drawer covers the
  // thing it is describing. The drawer is the fallback for widths with no room, not
  // the preferred form.
  const inspectorInline = useMediaQuery('(min-width: 1152px)');
  const historyInline = useMediaQuery('(min-width: 1024px)');

  const modelOptions = useMemo(
    () => manifestOptions.map((id) => ({ id, label: id })),
    [manifestOptions],
  );

  return (
    <>
      <div className="flex min-h-0 flex-1">
        {historyOpen && historyInline && (
          <ThreadList
            threads={threads}
            currentId={threadId}
            disabled={streaming}
            onSelect={selectThread}
            onNew={newThread}
            onDelete={deleteThread}
            onRename={renameThread}
            onFork={forkThread}
            onCompact={compactThread}
            onExport={exportThread}
          />
        )}
        <main className="flex min-w-0 flex-1 flex-col">
          <Conversation>
            {turns.length === 0 && (
              <Greeting manifest={manifest} disabled={streaming} onSend={send} />
            )}
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
            {reattaching && (
              <div
                role="status"
                className="mx-auto max-w-2xl rounded-lg border border-state-running/30 bg-state-running/10 px-3 py-2 text-sm text-state-running"
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
            {manifest === DEFAULT_MANIFEST ? <WorkspaceStrip /> : null}
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
        {inspectorOpen && inspectorInline && (
          <Inspector open={inspectorOpen} onClose={() => setInspectorOpen(false)} />
        )}
      </div>

      {/* Below their breakpoints the same rails become overlays. Same components and
        same toggle state, so the header buttons keep working and nothing is
        reachable in one layout but missing in the other. */}
      {!historyInline && (
        <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
          <SheetContent side="left" className="w-[17rem] gap-0 p-0 sm:max-w-none">
            <SheetTitle className="sr-only">Conversation history</SheetTitle>
            <ThreadList
              threads={threads}
              currentId={threadId}
              disabled={streaming}
              onSelect={(id) => {
                selectThread(id);
                setHistoryOpen(false);
              }}
              onNew={() => {
                newThread();
                setHistoryOpen(false);
              }}
              onDelete={deleteThread}
              onRename={renameThread}
              onFork={(id) => {
                forkThread(id);
                setHistoryOpen(false);
              }}
              onCompact={compactThread}
              onExport={exportThread}
              // The drawer supplies its own close button in the top-right corner, which
              // would otherwise land on top of this rail's "New chat" control.
              className="w-full border-r-0 bg-transparent [&>div:first-child]:pr-11"
            />
          </SheetContent>
        </Sheet>
      )}
      {!inspectorInline && (
        <Sheet open={inspectorOpen} onOpenChange={setInspectorOpen}>
          <SheetContent
            side="right"
            showCloseButton={false}
            className="w-[22rem] gap-0 p-0 sm:max-w-none"
          >
            <SheetTitle className="sr-only">Harness inspector</SheetTitle>
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
