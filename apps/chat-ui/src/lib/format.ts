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

/** `2:21 PM`, or `Tue 2:21 PM` when it was not today. */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return d.toLocaleString(undefined, {
    ...(sameDay ? {} : { weekday: 'short' }),
    hour: 'numeric',
    minute: '2-digit',
  });
}
