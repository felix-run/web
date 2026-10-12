import { useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import {
  clearMount,
  getMountLabel,
  pickDirectory,
  reconnectMount,
  restoreMount,
} from '@/lib/cowork';
import { WORKSPACE_WRITTEN } from '@/lib/workspace-events';

/**
 * Which folder the browser's client tools run against, for every surface that
 * says so: the sidebar's Workspace row and the pane's Files tab. It was one
 * component's state while one component showed it; two surfaces with a copy each
 * would disagree the moment one of them mounted a folder.
 *
 * Its first state on many mornings is not a folder. `restoreMount()` can only
 * return `needs-permission`, because the readwrite grant belongs to the document
 * and boot is not allowed to ask for it — so "Reconnect <name>" is a normal
 * resting state, not an error.
 */
export interface MountState {
  /** The mounted folder's name; null when tools run in the tab's own store. */
  label: string | null;
  /** A folder mounted last session, waiting on a grant only a click can ask for. */
  reconnect: string | null;
}

let state: MountState = { label: getMountLabel(), reconnect: null };
let restoreStarted = false;
const listeners = new Set<() => void>();

function set(next: MountState) {
  state = next;
  for (const l of listeners) l();
  // The trees re-read on this, as they do after a save from the pane.
  window.dispatchEvent(new Event(WORKSPACE_WRITTEN));
}

/** Once per page: whether last session's folder is usable depends on a grant boot cannot ask for. */
function restore() {
  if (restoreStarted) return;
  restoreStarted = true;
  void restoreMount().then((result) => {
    if (result.status === 'restored') set({ label: result.name, reconnect: null });
    else if (result.status === 'needs-permission') set({ ...state, reconnect: result.name });
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  restore();
  return () => listeners.delete(listener);
}

export function useMount(): MountState {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

/** Must be called inside the click: the folder picker opens only during a user gesture. */
export async function mountFolder(): Promise<void> {
  try {
    const name = await pickDirectory();
    set({ label: name, reconnect: null });
  } catch {
    // Picker cancelled.
  }
}

/** The same gesture rule as `mountFolder`: the permission prompt needs the click. */
export async function reconnectFolder(): Promise<void> {
  const name = await reconnectMount();
  if (!name) {
    // Not an error: the operator was asked for a folder and said no. Reporting a
    // decision back as a failure is how a surface teaches people to stop reading
    // its red.
    toast.message('No folder attached. The chat is using the in-tab workspace.');
    return;
  }
  set({ label: name, reconnect: null });
}

export function disconnectFolder() {
  clearMount();
  set({ label: null, reconnect: null });
}

/** For tests: forget what was restored. */
export function resetMountState() {
  state = { label: getMountLabel(), reconnect: null };
  restoreStarted = false;
}
