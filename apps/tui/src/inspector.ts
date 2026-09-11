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
 * The overlay has 72 columns at an eighty-column terminal: 80 less the two-cell
 * offset, the border and a column of padding each side. **Eight** sections × 9 =
 * 72 — exactly the budget, which is why this is 9 and not the 10 that fitted
 * seven. The renderable's default is 20, which shows three behind `‹ ›` arrows;
 * 11 showed six and the seventh disappeared with nothing on screen to say so.
 *
 * Names truncate to `tabWidth - 2`, so **7 characters** is the ceiling now. That
 * is why `Approvals` is `Waiting` here and why the audit feed is `Audit` rather
 * than chat-ui's `Activity` — a silently clipped tab is worse than an honest
 * shorter word, and this client has already made that trade once.
 *
 * A ninth section does not fit at eighty columns by shrinking this further: 8 is
 * already the ceiling for names anyone can read. It needs a second row, or a
 * section that has stopped earning its place. `tests/inspector.test.tsx` pins
 * the whole strip at eighty columns, so the arithmetic fails loudly.
 */
export const TAB_WIDTH = 9;

export interface Section {
  key: SectionKey;
  /** At most 7 characters — see `TAB_WIDTH`. */
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
  | 'documents'
  | 'skills';

/**
 * Frozen and module-level: `<tab-select>` re-clamps its selection whenever
 * `setOptions` runs, so this must never be rebuilt per render.
 */
export const SECTIONS: readonly Section[] = Object.freeze([
  { key: 'activity', name: 'Audit', description: 'what the harness recorded, newest first' },
  { key: 'approvals', name: 'Waiting', description: 'gated tool calls waiting on a person' },
  { key: 'plans', name: 'Plans', description: 'plans the agent wrote for itself' },
  { key: 'tools', name: 'Tools', description: 'per-tool calls, errors and mean latency' },
  { key: 'usage', name: 'Usage', description: 'tokens in and out, newest first' },
  { key: 'memory', name: 'Memory', description: 'facts kept across sessions — / to search' },
  {
    key: 'documents',
    name: 'Corpus',
    description: 'documents the agent retrieves from — / to search',
  },
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
