/**
 * Whose app this page last opened, once it has opened one (`components/gate.tsx`'s `Opened`).
 *
 * Module scope on purpose: a relock unmounts what the gate guards, but not the module caches
 * beneath it — a skill library, shared polls, a side pane's drafts — none of which name the person
 * they were read for. When the gate opens again for someone else, the page is loaded afresh
 * rather than handed what the last person left.
 */
let openedAs: string | null = null;
/** An identity already found stale: it stays so until the page reloads, however often it is asked. */
let staleFor: string | null = null;

/**
 * Note that the app opened for `identity`; true when it last opened for someone else. Asking again
 * for the same identity — a render React discarded and retried — gives the same answer.
 */
export function openFor(identity: string): boolean {
  if (staleFor === identity) return true;
  const stale = openedAs !== null && openedAs !== identity;
  if (stale) staleFor = identity;
  openedAs = identity;
  return stale;
}

/** Forget it — between tests, which would otherwise read each other's sign-ins as a switch. */
export function resetOpenedIdentity(): void {
  openedAs = null;
  staleFor = null;
}

/** Load `/` afresh: what the gate does when the identity under the app changes, and sign-out. */
export function reloadHome(): void {
  window.location.assign(`${window.location.origin}/`);
}
