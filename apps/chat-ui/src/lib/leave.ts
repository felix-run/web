/**
 * Signing out from the account chip: let go of what the session holds on the harness while it can
 * still ask, then forget it (`signOut`) and load `/` afresh.
 *
 * Each of these used to outlive a sign-out. A lease stayed held until its TTL, so another client saw
 * the thread as someone else's — and the keeper's late release, sent with no credential, came back
 * 401 and greeted the person who had just signed out with "That key was rejected". The browser kept
 * its push subscription, which the next sign-in re-registered under its own tenant, so a shared
 * device took both tenants' approval notifications. And module caches beneath the app — the skill
 * library, shared polls, the side pane's drafts — survived the relock; the reload drops them.
 *
 * Every step is best effort and bounded: leaving must not wait on, or fail with, a harness that is
 * not there.
 */
import { removeGitHubConnection } from '@/api';
import { signOut } from '@/lib/auth';
import { reloadHome } from '@/lib/opened-identity';
import { disablePush } from '@/lib/push';

/** How long the steps before forgetting may take, together. */
const LETTING_GO_MS = 2_500;

const steps = new Set<() => void | Promise<void>>();

/**
 * Run `step` when this page signs out, before the session is forgotten. The shell registers the
 * lease keeper's release here: the keeper is module state of the shell, which this cannot import.
 */
export function onLeave(step: () => void | Promise<void>): () => void {
  steps.add(step);
  return () => steps.delete(step);
}

export async function leave({ github }: { github: boolean }): Promise<void> {
  const work: Promise<unknown>[] = [...steps].map((step) => Promise.resolve().then(step));
  work.push(disablePush());
  // A Google session has no GitHub connection to forget.
  if (github) work.push(removeGitHubConnection());
  await Promise.race([
    Promise.allSettled(work),
    new Promise((resolve) => setTimeout(resolve, LETTING_GO_MS)),
  ]);
  signOut();
  reloadHome();
}
