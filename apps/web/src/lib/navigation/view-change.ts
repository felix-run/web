/**
 * Said just before the View level (Everyday / Harness / Debug) changes, synchronously,
 * while the page still shows the old one.
 *
 * `KeepPlaceAcrossViews` (`components/chat/conversation.tsx`) needs the reader's place as it
 * was before the change re-lays every turn out. It used to record that place on every scroll
 * event — five hit-tests and a row scan each, 430 `elementFromPoint` calls in one streamed
 * reply — for a change made perhaps once a session. Every setter of the level calls this
 * first; React renders after the handler returns, so a listener reads the old layout.
 */
export const VIEW_WILL_CHANGE = 'felix:view-will-change';

export function announceViewChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(VIEW_WILL_CHANGE));
}
