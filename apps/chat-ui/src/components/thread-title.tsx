import type { ThreadMeta } from '@felix/client';
import { cn } from '@felix/ui/lib/utils';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { threadLabel } from '@/lib/threads';

/** Characters kept whole at the end of a title cut from the middle. */
const TAIL_CHARS = 10;

/**
 * `text` on one line, cut from the **middle** when the room runs out.
 *
 * Two titles that share a prefix differ at the end — "Use write_file to create
 * notes.txt…" and "…notes.md…" — so an end-cut keeps exactly the half they
 * share. CSS has no middle ellipsis, and a cut by character count cannot follow
 * the header as it narrows, so this splits the string in two: the head
 * truncates with an ellipsis and gives way, the last few characters stay.
 * When the whole title fits the two halves meet and it reads as one string; a
 * screen reader reads both spans in order, so it always hears all of it.
 *
 * `whitespace-pre` rather than `truncate`'s `nowrap`, because a space at the
 * split would otherwise collapse at the end of the head and run two words
 * together.
 */
function MiddleCut({ text }: { text: string }) {
  const chars = Array.from(text);
  if (chars.length <= TAIL_CHARS * 2) {
    return <span className="min-w-0 overflow-hidden text-ellipsis whitespace-pre">{text}</span>;
  }
  return (
    <>
      {/* Below `sm` the room is ~70px: a head, an ellipsis and a tail all cut
          again read as noise, so a phone gets one end-cut. `display: none`
          takes whichever copy is off screen out of the accessibility tree. */}
      <span className="min-w-0 truncate whitespace-pre sm:hidden">{text}</span>
      <span className="hidden min-w-0 sm:flex">
        <span className="min-w-[3ch] shrink overflow-hidden text-ellipsis whitespace-pre">
          {chars.slice(0, -TAIL_CHARS).join('')}
        </span>
        {/* Never cut: it is the half that tells two titles apart. The header's
            floor for this cluster leaves it room from `sm`. */}
        <span className="shrink-0 whitespace-pre">{chars.slice(-TAIL_CHARS).join('')}</span>
      </span>
    </>
  );
}

/**
 * The thread on screen, named in the header: its title, and the agent it runs on.
 *
 * Until this, the main sheet never said which conversation it held. Identity
 * lived only in the sidebar's highlighted row, so with the sidebar collapsed —
 * or below 1024, where it is a drawer — nothing named the thread an operator was
 * about to approve a write on or send into.
 *
 * The title is the sidebar row's (`threadLabel`, over the same merged index), so
 * the two never disagree. A title that is only the harness's id is drawn as the
 * row draws it, muted mono. The agent is mono for the Provenance Rule: it is the
 * harness's manifest id, quoted back. It is the agent the newest turn ran under,
 * which a thread from another browser on an older harness does not report; then
 * it says nothing rather than guess.
 *
 * An `h2`: the wordmark is the page's one `h1`, and this names what the sheet
 * below it holds, the way a `/harness` page's own `h2` names that page.
 *
 * Clicking the title renames it in place, through the same action as the
 * sidebar's Rename (`POST /chat/sessions/name`). It is not editable while this
 * tab only watches the thread, nor before the thread exists on the harness: a
 * fresh thread has nothing to name until its first message.
 */
export function ThreadTitle({
  threadId,
  thread,
  readOnly,
  onRename,
  className,
}: {
  threadId: string;
  /** The thread's index entry, when the merged index has one. */
  thread: ThreadMeta | undefined;
  /** Another client drives this thread; this tab only watches it. */
  readOnly: boolean;
  onRename: (id: string, name: string) => void;
  className?: string;
}) {
  const label = useMemo(
    () => (thread ? threadLabel(thread) : { text: threadId, isId: true }),
    [thread, threadId],
  );
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  /**
   * Set when Escape or Enter has already settled the edit. The input unmounts
   * under the key, and a browser that fires `blur` on the way out would
   * otherwise commit the draft Escape was meant to throw away.
   */
  const settled = useRef(false);
  const hintId = useId();
  const editable = !readOnly && thread !== undefined;
  const editing = draft !== null && editable;

  // A thread change ends an edit: the draft was a name for the other thread.
  useEffect(() => {
    setDraft(null);
  }, [threadId]);

  // After paint, so focus lands in the field the click has just mounted.
  useEffect(() => {
    if (!editing) return;
    settled.current = false;
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [editing]);

  function finish(commit: boolean) {
    if (settled.current) return;
    settled.current = true;
    const name = draft?.trim() ?? '';
    if (commit && thread && name && name !== thread.title) onRename(thread.id, name);
    setDraft(null);
    requestAnimationFrame(() => buttonRef.current?.focus());
  }

  const text = (
    <span
      className={cn(
        'flex min-w-0',
        label.isId ? 'font-mono text-muted-foreground' : 'font-medium text-foreground',
      )}
    >
      <MiddleCut text={label.text} />
    </span>
  );

  return (
    <div
      data-slot="thread-title"
      // Under 23rem (a 320–360px phone) the title has under 40px left: a sliver
      // of a glyph reads as a rendering fault, so it leaves the screen and stays
      // the heading for a reader.
      className={cn('flex min-w-0 items-center gap-2 max-[23rem]:sr-only', className)}
    >
      {editing ? (
        <input
          ref={inputRef}
          aria-label="Thread name"
          value={draft ?? ''}
          placeholder={label.isId ? 'Name this thread' : label.text}
          onChange={(e) => setDraft(e.target.value)}
          // Commit rather than discard, as the sidebar's field does: a stray
          // click losing a typed name is worse than a rename undone by another.
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              finish(true);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              finish(false);
            }
          }}
          className="h-7 w-96 min-w-0 max-w-full rounded-md border border-input bg-background px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        />
      ) : (
        <h2 className="flex min-w-0 text-sm">
          {editable ? (
            <button
              ref={buttonRef}
              type="button"
              data-slot="thread-title-button"
              // The whole title, since the header may be showing a cut of it,
              // and the id, since two threads can carry the same title.
              title={`${label.isId ? label.text : `${label.text}\nThread ${threadId}`}\nClick to rename`}
              aria-describedby={hintId}
              onClick={() => setDraft(thread?.named ? thread.title : '')}
              className="flex min-w-0 cursor-text items-center rounded-md px-1.5 py-0.5 -mx-1.5 outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring"
            >
              {text}
            </button>
          ) : (
            <span
              data-slot="thread-title-text"
              className="flex min-w-0"
              title={
                readOnly
                  ? `${label.text}\nAnother client is driving this thread, so it cannot be renamed here.`
                  : label.text
              }
            >
              {text}
            </span>
          )}
        </h2>
      )}
      {/* Outside the heading, so it is the button's description and not part of
          the thread's name in the page outline. `hidden` still describes. */}
      {editable && !editing && (
        <span id={hintId} hidden>
          Rename this thread
        </span>
      )}
      {thread?.manifest && (
        // Hidden below `md`: between 640 and 768 the sidebar is a drawer, the
        // header also holds the brand and New chat, and an agent id beside the
        // title left the title itself ~100px — cut twice over. The agent is in
        // the composer's picker beneath it at every width.
        <span
          data-slot="thread-agent"
          title={`Agent: ${thread.manifest}`}
          className="shrink-0 font-mono text-xs text-muted-foreground max-md:hidden"
        >
          <span className="sr-only">Agent </span>
          {thread.manifest}
        </span>
      )}
    </div>
  );
}
