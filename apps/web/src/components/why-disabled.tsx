/**
 * The reason a submit is unavailable, said beside it. A disabled button's only signal was its
 * 50% grey, and a `title` cannot carry the reason because a disabled element fires no hover.
 * The button names this line with `aria-describedby`, so a screen reader hears it on focus too.
 */
export function WhyDisabled({ id, reason }: { id: string; reason: string | null }) {
  if (!reason) return null;
  return (
    <p id={id} className="self-center text-xs text-muted-foreground">
      {reason}
    </p>
  );
}
