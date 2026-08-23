import type { TimelineItem } from '@/types';

/**
 * Close out any tool row that never reported back.
 *
 * A run ends for three reasons: it finished, the user stopped it, or it failed.
 * In the last two — and in the first if a `tool_end` simply never arrived — a
 * row can be left on 'running'. A spinner that outlives the run that owned it
 * reads as work still in progress, which is the one thing it is not.
 *
 * Rows that already settled are returned untouched, and the array identity is
 * preserved when there is nothing to do, so this is safe to call on every run
 * teardown without forcing a render.
 */
export function settleRunningTools(timeline: TimelineItem[]): TimelineItem[] {
  if (!timeline.some((item) => item.kind === 'tool' && item.status === 'running')) {
    return timeline;
  }
  return timeline.map((item) =>
    item.kind === 'tool' && item.status === 'running'
      ? { ...item, status: 'error' as const, body: item.body || 'no result reported' }
      : item,
  );
}
