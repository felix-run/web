/**
 * Relative time, in the one format this app uses.
 *
 * There were three of these, in the thread list, the jobs sheet, and the inspector,
 * disagreeing on both direction and wording: one handled only the past, one handled
 * both but rendered anything under a minute as "0m ago". A scheduled job shows its
 * last run and its next run side by side, so the direction is not optional.
 *
 * @param ts  timestamp in ms
 * @param now injectable so tests do not depend on the clock
 */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const diff = ts - now; // future is positive
  const abs = Math.abs(diff);

  if (abs < 60_000) return diff >= 0 ? 'in a moment' : 'just now';

  const unit =
    abs < 3_600_000
      ? `${Math.round(abs / 60_000)}m`
      : abs < 86_400_000
        ? `${Math.round(abs / 3_600_000)}h`
        : `${Math.round(abs / 86_400_000)}d`;

  return diff >= 0 ? `in ${unit}` : `${unit} ago`;
}

/**
 * `42s`, `3:07`, `1:02:09` — a stopwatch, not a relative time.
 *
 * Shared by both clients' run readouts and reasoning rows, so a run that took
 * three minutes reads the same in a browser as in a terminal.
 */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
