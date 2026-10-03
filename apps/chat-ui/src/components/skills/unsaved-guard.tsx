import { Button } from '@felix/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@felix/ui/dialog';
import { useContext } from 'react';
import { type Location, UNSAFE_DataRouterContext, useBlocker } from 'react-router';

/**
 * Stops an in-app navigation that would drop unsaved skill edits, and asks.
 *
 * `useBlocker` exists only under a *data* router, which is why `main.tsx`
 * mounts `createBrowserRouter` around the declarative route table. A test, or
 * any other host, that renders the app under `MemoryRouter` has no data
 * router; there this renders nothing rather than throwing, and the editor's
 * own `beforeunload` still covers a reload. The check is the context's
 * presence, which cannot change during a component's life, so the hook below
 * is never called conditionally within one mount.
 *
 * `leaves` decides what counts as leaving. Switching the skill page's tabs
 * moves the URL too, and must not ask: the edits live above the tabs and
 * survive the switch.
 */
export function UnsavedChangesGuard({
  when,
  leaves,
}: {
  when: boolean;
  leaves: (from: Location, to: Location) => boolean;
}) {
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  if (!dataRouter) return null;
  return <BlockerDialog when={when} leaves={leaves} />;
}

function BlockerDialog({
  when,
  leaves,
}: {
  when: boolean;
  leaves: (from: Location, to: Location) => boolean;
}) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => when && leaves(currentLocation, nextLocation),
  );
  const open = blocker.state === 'blocked';
  return (
    <Dialog open={open} onOpenChange={(o) => !o && blocker.reset?.()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Leave without saving?</DialogTitle>
          <DialogDescription>
            This skill has edits that are not saved as a version. Leaving discards them.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => blocker.reset?.()}>
            Keep editing
          </Button>
          <Button variant="destructive" onClick={() => blocker.proceed?.()}>
            Discard and leave
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
