import { middleTruncate } from '@/lib/format';

/**
 * An id at most `max` characters wide, cut from the middle (see
 * `middleTruncate`), and whole to a screen reader — which has no ellipsis to
 * decode, and would otherwise be read half an id as though it were all of it.
 * An id that fits is drawn once, as itself.
 */
export function CutId({ id, max }: { id: string; max: number }) {
  const cut = middleTruncate(id, max);
  if (cut === id) return <>{id}</>;
  return (
    <>
      <span aria-hidden>{cut}</span>
      <span className="sr-only">{id}</span>
    </>
  );
}
