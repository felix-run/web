/**
 * `s` at most `max` characters long, cut from the middle with one `…`.
 *
 * The rule for any id that has to tell rows apart (DESIGN.md, *Panels and
 * sections*): a shared prefix names the kind of work and the tail names the
 * instance, so an end-cut keeps the half two ids share and drops the half that
 * differs. `self-pr-306` and `self-pr-311` are the same eight characters.
 *
 * The head gets the smaller half because a common prefix is the likeliest thing
 * two ids share; the tail is what distinguishes them. Wherever this is drawn the
 * whole id goes in `title` and in the accessible name, because a screen reader
 * has no ellipsis to decode.
 */
export function middleTruncate(s: string, max: number): string {
  if (s.length <= max) return s;
  const keep = Math.max(0, max - 1);
  const head = Math.floor(keep / 2);
  return `${s.slice(0, head)}…${s.slice(s.length - (keep - head))}`;
}

/** `42s`, `3:07`, `1:02:09` — a stopwatch, not a relative time. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  if (total < 60) return `${total}s`;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = String(total % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}
