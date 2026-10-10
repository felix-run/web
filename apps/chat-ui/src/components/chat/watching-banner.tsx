import { Marker, MarkerContent, MarkerIcon } from '@felix/ui/marker';
import { EyeIcon } from 'lucide-react';

/**
 * Why the composer will not send while this tab watches — its helper line, and Enter's refusal.
 * Short, because the banner above it says the rest and the line truncates.
 */
export const WATCHING_REFUSAL = 'Watching read-only.';
/**
 * The footer's word for it. Between the pickers and the context meter the
 * footer had room for "Watching read-" and cut the rest; the sentence stays in
 * the hint's `title` and is what a screen reader hears.
 */
export const WATCHING_LABEL = 'Watching';

/** Who the harness says is driving, as far as this tab can tell without showing an id. */
export type Driver = 'terminal' | 'other';

/**
 * This tab is watching a thread another client drives.
 *
 * The harness gave this tab an observer hold (`held_by_other`), or refused one
 * of its writes (`lease_read_only` / `lease_held`). Nothing is wrong and nobody
 * is asked to act, so it is a marker in the transcript's voice — the same idiom
 * as the reattach note — not an alert: a red or amber card here would read as a
 * failure, and the tab is behaving exactly as it should. It says what is
 * happening and what will happen next, in words; the icon only repeats them.
 *
 * `role="status"`, so arriving here is announced once, politely, and clearing
 * it — the takeover — removes the element rather than announcing anything.
 */
export function WatchingBanner({ driver = 'other' }: { driver?: Driver }) {
  return (
    <div className="mx-auto mb-3 w-full max-w-3xl px-4 md:px-6">
      <Marker
        role="status"
        data-testid="watching-banner"
        className="rounded-xl border border-border/70 bg-muted/40 px-3 py-2"
      >
        <MarkerIcon>
          <EyeIcon />
        </MarkerIcon>
        <MarkerContent>
          <span className="text-foreground">
            {driver === 'terminal'
              ? 'A terminal session is driving this conversation — watching read-only.'
              : 'Another tab or client is driving this conversation — watching read-only.'}
          </span>{' '}
          This tab takes over on its own once the conversation is free.
        </MarkerContent>
      </Marker>
    </div>
  );
}
