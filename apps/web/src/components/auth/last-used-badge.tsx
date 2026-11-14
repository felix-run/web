/**
 * "Last used", on the sign-in button for the provider this browser signed in with last.
 *
 * Where the gate offers more than one way in, the person most likely wants the one they used
 * before, and an account picker that remembers is a small kindness. It names a provider, never
 * an account: the gate is shown to whoever opens the page.
 *
 * It sits on the button's top edge, a tab on the border, rather than inside it at the end:
 * inside, it covered the provider's name on any phone narrower than about 400px, the name being
 * the one word that tells the two buttons apart. On the edge it collides with nothing at any
 * width. 12px, the bottom of the type ramp, on the card colour so the border runs behind it.
 */

import { Badge } from '@felix/ui/badge';

export function LastUsedBadge() {
  return (
    <Badge
      variant="outline"
      className="pointer-events-none absolute -top-2.5 right-4 h-5 bg-card px-2 py-0 font-normal text-muted-foreground"
    >
      Last used
    </Badge>
  );
}
