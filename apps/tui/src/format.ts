/** Small presentational helpers the inspector's rows need. */

/**
 * How long ago, in the fewest characters that stay honest.
 *
 * Seconds inside the first minute, because a burst of tool calls all land in
 * the same minute and a column of `1m ago` says nothing about their order.
 * A timestamp of zero — a thread the harness knows about and this client has
 * never written — renders as nothing rather than as 1970.
 */
export function relTime(ts: number | null | undefined, now = Date.now()): string {
  if (!ts) return '';
  const delta = Math.max(0, now - ts);
  const s = Math.floor(delta / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** A token count that fits a narrow column. */
export function compact(n: number | null | undefined): string {
  const v = n ?? 0;
  if (v < 1000) return String(v);
  if (v < 1_000_000) return `${(v / 1000).toFixed(v < 10_000 ? 1 : 0)}k`;
  return `${(v / 1_000_000).toFixed(1)}M`;
}

/**
 * Right-align a cell.
 *
 * `TextTable` has no per-column alignment, so a column of numbers is ragged
 * unless the padding is done here — which is the one thing about that
 * renderable worth knowing before using it for a metrics table.
 */
export function num(value: string | number, width: number): string {
  return String(value).padStart(width);
}
