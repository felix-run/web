/**
 * What the inspector shows, and how much room it gets.
 *
 * The sections are the harness's operator surface, read-only: what it *did*,
 * what it is *waiting on*, what it *planned*, what its tools cost, what it
 * *spent*, what it *remembers*, and what it can do. They were the web app's
 * alone until `@felix/client` grew the reads, which made them browser-only by
 * accident rather than by design — and this is the client with a real working
 * directory, so "why did it do that" gets asked here first.
 */

/**
 * Columns per tab in the section strip.
 *
 * Seven sections × 10 = 70, inside the 72 columns the overlay actually has at
 * an eighty-column terminal: 80 less the two-cell offset, the border and a
 * column of padding each side. The renderable's default is 20, which shows
 * **three** of the seven behind `‹ ›` arrows, and 11 shows six — the seventh
 * disappears with nothing on screen to say it has.
 *
 * Names truncate to `tabWidth - 2` = 8, which is why the approvals section is
 * called `Waiting` here: `Approvals` does not fit, and a silently clipped tab
 * is worse than an honest shorter word. Renaming a section means redoing this
 * arithmetic, which `tests/inspector.test.tsx` pins at eighty columns.
 */
export const TAB_WIDTH = 10;

export interface Section {
  key: SectionKey;
  /** At most 9 characters — see `TAB_WIDTH`. */
  name: string;
  /** Drawn in the overlay's bottom border, where there is room for a sentence. */
  description: string;
}

export type SectionKey =
  | 'activity'
  | 'approvals'
  | 'plans'
  | 'tools'
  | 'usage'
  | 'memory'
  | 'skills';

/**
 * Frozen and module-level: `<tab-select>` re-clamps its selection whenever
 * `setOptions` runs, so this must never be rebuilt per render.
 */
export const SECTIONS: readonly Section[] = Object.freeze([
  { key: 'activity', name: 'Activity', description: 'what the harness recorded, newest first' },
  { key: 'approvals', name: 'Waiting', description: 'gated tool calls waiting on a person' },
  { key: 'plans', name: 'Plans', description: 'plans the agent wrote for itself' },
  { key: 'tools', name: 'Tools', description: 'per-tool calls, errors and mean latency' },
  { key: 'usage', name: 'Usage', description: 'tokens in and out, newest first' },
  { key: 'memory', name: 'Memory', description: 'facts kept across sessions — / to search' },
  {
    key: 'skills',
    name: 'Skills',
    description: 'declared and active, as the agent last listed them',
  },
]);

/** How often a visible section re-reads. Matches chat-ui's inspector. */
export const POLL_MS = 3000;

/** Rows the panel body may draw into, given the terminal's height. */
export function inspectorRows(height: number): number {
  // The overlay is absolute, so asking for more rows than fit does not shrink
  // it — it draws over the composer, which is the failure the thread rail's
  // own arithmetic exists to avoid. Leave the composer, the notice and the
  // status line their rows, plus the strip and two borders.
  const spare = height - 12;
  if (spare < 3) return Math.max(0, spare);
  return Math.min(spare, 18);
}
