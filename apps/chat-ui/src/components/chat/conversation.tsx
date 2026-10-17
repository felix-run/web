import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScroller,
} from '@felix/ui/message-scroller';
import { type ComponentProps, type ReactNode, useEffect, useLayoutEffect, useRef } from 'react';
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
 * **Row identity matters too.** The scroller remembers which anchors it has
 * already handled by their DOM element, so rows are keyed by position in
 * `routes/workbench.tsx` — re-created rows (a snapshot rebuild re-mints turn ids)
 * all read as unhandled, and it jumped to the first one, 3,600px from the question.
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
        {/* `overflow-anchor: none`: the browser's own scroll anchoring locked onto a
            node inside the reply and pulled the view down as it grew, scrolling the
            question it had just anchored off the top. Measured on a live run: the
            question drifted from 80px to -381px with no input at all. The scroller
            does its own anchoring; the browser's fights it. */}
        <MessageScrollerViewport aria-label="Transcript" className="[overflow-anchor:none]">
          {/* `min-h-full` gives the empty-state greeting the whole column to sit at
              the bottom of; with turns present the content is taller and it is inert.
              `aria-busy` while a reply is being written, so a screen reader reads the
              finished turn rather than every delta. */}
          {/* The spacer's `-mb-0.5` takes back what the primitive's rounding adds.
              It sizes the spacer to fill the viewport below the last anchor from
              `clientHeight`, which is the viewport's height *rounded*, then
              `Math.ceil`s the result — so a fractional viewport (664.92px) got
              content up to ~1.5px taller than itself, and every short thread drew
              a near-full scrollbar thumb for a 1px scroll (666 over 665). Two
              pixels under is invisible; the anchor still reaches the top. */}
          <MessageScrollerContent
            aria-busy={streaming}
            className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6 md:py-8"
            spacerClassName="-mb-0.5"
          >
            {children}
          </MessageScrollerContent>
        </MessageScrollerViewport>
        <KeepPlaceAcrossViews />
        {/* The jump to the latest reply has a strip of its own under the viewport,
            never a place over it. Floating bottom-centre over the transcript it
            sat on whatever was there whenever there was more below — a plan step
            at 390px, a workspace note, the tokens line under a reply — which is
            exactly when someone is reading. Padding the content would not have
            helped: the button only shows away from the end, where the padding is
            not on screen. The strip is absent on an empty thread, which has
            nothing to jump to, so the greeting still sits on the composer.

            Inert, not unmounted, while there is nothing further down: it fades and
            leaves the tab order rather than popping in and out of the layout. */}
        <div
          data-slot="conversation-jump"
          className={cn('relative shrink-0', lastAnchorId ? 'h-10' : 'h-0')}
        >
          <MessageScrollerButton
            direction="end"
            variant="outline"
            className="z-10 rounded-full border-border/60 bg-card shadow-md data-[direction=end]:bottom-1"
            aria-label="Scroll to latest"
          />
        </div>
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
 * Opens the thread on its newest question, and holds it there while the thread
 * settles.
 *
 * The scroller's own `defaultScrollPosition` only runs when the transcript goes
 * from no rows to some *after* it mounts, and a cached thread has its rows on the
 * first render, so this makes the opening move itself, retried for a few frames
 * because the rows register with the scroller from their own effects.
 *
 * Landing once is not enough. A thread opens from the local cache and is then
 * rebuilt from the harness's snapshot, and rows above the question keep growing
 * after the jump: code blocks highlight, tool cards fill in. With the viewport's
 * `overflow-anchor: none` nothing compensates, and on a live thread the question
 * slid ~6,000px below the view. So whenever the content resizes the viewport is
 * moved by however far the question has drifted from where it landed, until the reader takes over (wheel, touch, a key, a pointer on the
 * scrollbar) or the content has been still for `SETTLE_MS`.
 */
const SETTLE_MS = 1500;

/**
 * Dispatched on the viewport by anything else that has placed the reader, so the
 * opening hold lets go rather than dragging the view back to the question.
 */
const HOLD_RELEASE = 'felix:hold-release';

function OpenAtLastAnchor({ anchorId }: { anchorId: string | undefined }) {
  const { scrollToMessage } = useMessageScroller();
  const probe = useRef<HTMLSpanElement>(null);
  const opened = useRef(false);
  // The anchor this instance last held. A different one means a message was just
  // sent: the scroller has already placed it, with the previous turn peeking
  // above, so it is held where it was put rather than re-aimed.
  const held = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (opened.current || !anchorId) return;
    opened.current = true;
    const placedByScroller = held.current !== undefined && held.current !== anchorId;
    held.current = anchorId;
    const root = probe.current?.closest('[data-slot="conversation"]');
    const viewport = root?.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]');
    const content = root?.querySelector<HTMLElement>('[data-slot="message-scroller-content"]');

    // Where the question sits after the jump, relative to the viewport's top.
    // Held by moving the viewport, not by asking the scroller again: re-calling
    // `scrollToMessage` on a resize measured the same target and left the
    // question 6,000px down while the rows above it filled in.
    let landedAt: number | null = null;
    const anchorTop = () => {
      const el = viewport?.querySelector<HTMLElement>(`[data-message-id="${anchorId}"]`);
      if (!el || !viewport) return null;
      return el.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    };
    let tries = 0;
    const attempt = () => {
      if (placedByScroller || scrollToMessage(anchorId, { align: 'start', behavior: 'instant' })) {
        requestAnimationFrame(() => {
          landedAt = anchorTop();
        });
        return;
      }
      if (++tries < 10) requestAnimationFrame(attempt);
    };
    requestAnimationFrame(attempt);
    if (!viewport || !content) return;

    // The global timers, not `window`'s: `release` can run from a timer after the document is
    // gone (a test's environment torn down under a still-armed hold), and `window.` then threw
    // an unhandled ReferenceError that failed the suite after every test had passed.
    let quiet = setTimeout(release, SETTLE_MS);
    const observer = new ResizeObserver(() => {
      const now = anchorTop();
      if (landedAt !== null && now !== null && Math.abs(now - landedAt) > 1) {
        viewport.scrollTop += now - landedAt;
      }
      clearTimeout(quiet);
      quiet = setTimeout(release, SETTLE_MS);
    });
    observer.observe(content);
    const intents = ['wheel', 'touchstart', 'keydown', 'pointerdown', HOLD_RELEASE] as const;
    for (const type of intents) viewport.addEventListener(type, release, { passive: true });
    function release() {
      observer.disconnect();
      clearTimeout(quiet);
      for (const type of intents) viewport?.removeEventListener(type, release);
    }
    // Released on cleanup, and re-armed: StrictMode runs this effect twice, and a
    // guard left set by the first run would skip the hold entirely. A new anchor
    // (a message just sent) re-runs it too, which holds the new question in place
    // while its reply starts — the same promise the scroller's own anchoring makes.
    return () => {
      release();
      opened.current = false;
    };
  }, [anchorId, scrollToMessage]);
  return <span ref={probe} hidden />;
}

function viewportOf(probe: HTMLElement | null): HTMLElement | null {
  return (
    probe
      ?.closest('[data-slot="conversation"]')
      ?.querySelector<HTMLElement>('[data-slot="message-scroller-viewport"]') ?? null
  );
}

/** How long a restored place is held while late layout (highlighting, lazy cards) lands. */
const VIEW_HOLD_MS = 600;

type Place = { el: Element; top: number };

/**
 * What the reader is looking at: the elements on the reading column's centre line
 * near the viewport's top, those starting nearest the top edge first, then the row
 * they are in — each with its offset from the viewport's top. An element that
 * starts far above the edge is a container (a whole turn, measured live: the hit
 * 8px down was the operator turn above, starting at -186px), and its top does not
 * move when the lines inside it change; one that starts at the edge does. Several,
 * because the view change this serves can remove one (a debug-only line) and the
 * next stands in.
 */
function capturePlace(viewport: HTMLElement): Place[] {
  const box = viewport.getBoundingClientRect();
  const at = (el: Element) => el.getBoundingClientRect().top - box.top;
  const hits: Element[] = [];
  if (typeof document.elementFromPoint === 'function') {
    const x = box.left + box.width / 2;
    for (const dy of [8, 32, 64, 120, 200]) {
      const el = document.elementFromPoint(x, box.top + dy);
      if (el && el !== viewport && viewport.contains(el) && !hits.includes(el)) hits.push(el);
    }
  }
  const near = hits.filter((el) => at(el) >= -80).sort((a, b) => Math.abs(at(a)) - Math.abs(at(b)));
  const picks = [...near];
  for (const row of viewport.querySelectorAll('[data-message-id]')) {
    if (row.getBoundingClientRect().bottom > box.top) {
      if (!picks.includes(row)) picks.push(row);
      break;
    }
  }
  return picks.map((el) => ({ el, top: at(el) }));
}

/**
 * Keeps the reader's place when the View changes (Everyday / Harness / Debug).
 *
 * Each level adds or removes lines inside turns — tool cards, a tokens line, ids
 * — so the content above the reader changed height and, with the viewport's
 * `overflow-anchor: none`, the view landed somewhere else entirely. The place is
 * recorded on every scroll (one frame's worth of reads), and after the change
 * commits the viewport is moved by however far that place drifted, then held for
 * a moment while late layout lands, unless the reader takes over. It tells
 * `OpenAtLastAnchor` to let go first: a switch made while a thread is still
 * settling would otherwise be dragged back to the question.
 */
function KeepPlaceAcrossViews() {
  const { view } = useShell();
  const probe = useRef<HTMLSpanElement>(null);
  const place = useRef<Place[] | null>(null);

  useEffect(() => {
    const viewport = viewportOf(probe.current);
    if (!viewport) return;
    let frame = 0;
    const record = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        place.current = capturePlace(viewport);
      });
    };
    record();
    viewport.addEventListener('scroll', record, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('scroll', record);
    };
  }, []);

  const lastView = useRef(view);
  useLayoutEffect(() => {
    if (lastView.current === view) return;
    lastView.current = view;
    const viewport = viewportOf(probe.current);
    const saved = place.current;
    if (!viewport || !saved?.length) return;
    viewport.dispatchEvent(new Event(HOLD_RELEASE));
    const restore = () => {
      const target = saved.find((p) => p.el.isConnected);
      if (!target) return;
      const now = target.el.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
      if (Math.abs(now - target.top) > 1) viewport.scrollTop += now - target.top;
    };
    restore();
    const content = viewport.querySelector('[data-slot="message-scroller-content"]');
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(restore) : null;
    if (content) observer?.observe(content);
    const intents = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    const stop = () => {
      observer?.disconnect();
      clearTimeout(timer);
      for (const type of intents) viewport.removeEventListener(type, stop);
    };
    const timer = setTimeout(stop, VIEW_HOLD_MS);
    for (const type of intents) viewport.addEventListener(type, stop, { passive: true });
    return stop;
  }, [view]);

  return <span ref={probe} hidden />;
}
