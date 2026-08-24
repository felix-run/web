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
