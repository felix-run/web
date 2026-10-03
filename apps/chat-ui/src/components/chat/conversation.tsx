import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from '@felix/ui/message-scroller';
import { type ComponentProps, type ReactNode, useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { useShell } from '@/shell-context';

/**
 * The transcript's scroller, built around the turn rather than the bottom edge.
 *
 * Every operator message is a **scroll anchor**: when one is sent it lands near the
 * top of the view, with a peek of the turn before it, and the reply grows beneath
 * it. The view follows the stream only while the reader is at the live edge;
 * scrolling away, or a key in the transcript, releases it, and new deltas arrive
 * off-screen without moving what is being read. Following the bottom instead made
 * a long tool-heavy reply scroll its own question out of view, and dragged a
 * reader who had scrolled up to check a tool card back down on every delta.
 *
 * **One scroller per thread.** The route does not remount on `/t/a` → `/t/b`, so
 * the provider is keyed on the thread: its "the reader left the edge" state is
 * about one conversation, and carried into the next it opened the new thread at
 * whatever offset the last was left at. A thread opens at its **last anchor** —
 * the most recent question and what came of it — rather than at the absolute
 * bottom, which on a long reply is its last paragraph with no question above it.
 *
 * **What counts as a row matters.** The opening position is applied when the
 * transcript goes from no rows to some, and rows added after that are read as new
 * messages — a new anchor scrolls to itself. So the empty-thread greeting is *not*
 * a row (with it counted, a thread's turns arriving read as messages just sent,
 * and it opened on its first question), and a row's id is its position rather than
 * its turn id: rebuilding a thread from the harness's snapshot can re-mint turn
 * ids, and the same transcript under new ids would read as a page of new anchors.
 *
 * The scroller tracks position with `data-*` attributes rather than state, so a
 * scroll costs no render. Rows are drawn in full — see `ConversationItem` for why
 * the primitive's off-screen placeholders are switched off.
 */
export function Conversation({
  children,
  lastAnchorId,
  className,
}: {
  children: ReactNode;
  /** The row id of the newest operator turn, which a thread opens on. */
  lastAnchorId?: string;
  className?: string;
}) {
  const { threadId, streaming } = useShell();
  return (
    <MessageScrollerProvider
      key={threadId}
      defaultScrollPosition="last-anchor"
      scrollPreviousItemPeek={48}
    >
      <MessageScroller
        data-slot="conversation"
        className={cn('relative min-h-0 flex-1', className)}
      >
        <OpenAtLastAnchor anchorId={lastAnchorId} />
        <MessageScrollerViewport aria-label="Transcript">
          {/* `min-h-full` gives the empty-state greeting the whole column to sit at
              the bottom of; with turns present the content is taller and it is inert.
              `aria-busy` while a reply is being written, so a screen reader reads the
              finished turn rather than every delta. */}
          <MessageScrollerContent
            aria-busy={streaming}
            className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8"
          >
            {children}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        {/* Inert, not unmounted, while there is nothing further down: it fades and
            leaves the tab order rather than popping in and out of the layout. */}
        <MessageScrollerButton
          direction="end"
          variant="outline"
          className="z-10 rounded-full border-border/60 bg-card shadow-md"
          aria-label="Scroll to latest"
        />
      </MessageScroller>
    </MessageScrollerProvider>
  );
}

/**
 * One row of the transcript. An operator turn is an anchor (`anchor`); everything
 * else — replies, notices, the greeting — is a row the reader scrolls past.
 */
export function ConversationItem({
  id,
  anchor = false,
  className,
  ...props
}: Omit<ComponentProps<typeof MessageScrollerItem>, 'messageId' | 'scrollAnchor'> & {
  id: string;
  anchor?: boolean;
}) {
  // Rendered in full, not `content-visibility: auto`. With the primitive's
  // default a row off screen is a 10rem placeholder until it is painted, so the
  // opening jump to the newest question was measured against a long reply's
  // placeholder and drifted by the difference once the reply drew — measured at
  // 1440px: the question landed ~900px below where it was aimed.
  return (
    <MessageScrollerItem
      messageId={id}
      scrollAnchor={anchor}
      className={cn('[content-visibility:visible]', className)}
      {...props}
    />
  );
}

/**
 * Opens the thread on its newest question.
 *
 * The scroller's own `defaultScrollPosition` only runs when the transcript goes
 * from no rows to some *after* it mounts, and a cached thread has its rows on the
 * first render — so on its own it left the thread at the top. This makes the
 * opening move once, retried for a few frames because the rows register with the
 * scroller from their own effects and the call does nothing until the anchor's
 * has. Never again after that: from then on the reader decides where it sits.
 */
function OpenAtLastAnchor({ anchorId }: { anchorId: string | undefined }) {
  const { scrollToMessage } = useMessageScroller();
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !anchorId) return;
    opened.current = true;
    let tries = 0;
    const attempt = () => {
      if (scrollToMessage(anchorId, { align: 'start', behavior: 'instant' })) return;
      if (++tries < 10) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
  }, [anchorId, scrollToMessage]);
  return null;
}
