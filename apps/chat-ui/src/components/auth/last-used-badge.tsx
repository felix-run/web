/**
 * "Last used", on the sign-in button for the provider this browser signed in with last.
 *
 * Where the gate offers more than one way in, the person most likely wants the one they used
 * before, and an account picker that remembers is a small kindness. It names a provider, never
 * an account: the gate is shown to whoever opens the page.
 */

import { Badge } from '@felix/ui/badge';

export function LastUsedBadge() {
  return (
    <Badge
      variant="secondary"
      className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0 text-[10px] font-medium"
    >
      Last used
    </Badge>
  );
}
