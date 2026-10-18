/**
 * What this browser keeps that belongs to whoever is signed in, and forgetting it.
 *
 * Threads, transcripts, durable-run tokens, the chosen agent and tenant: each is kept under a key
 * that names a thread or nothing at all, never a person, because a browser was assumed to be one
 * person's. It is not — a family laptop, a GitHub sign-in and a Google one — and a sign-out that
 * forgot only the token left the last person's transcripts for the next to open from the cache.
 *
 * `auth.ts` calls `forgetIdentityState` on sign-out, and whenever a credential for a different
 * identity is stored (`IDENTITY_MARKER` holds whose state is here). Preferences that say nothing
 * about a person — the theme, a folded sidebar, the last sign-in provider — are kept.
 *
 * Imports nothing at load, so the credential module — which nearly everything imports — can use it
 * without a cycle and without carrying the cowork client into every page and test that signs in.
 */

/** Whose state this browser holds: `auth.ts`'s `identityKey()` at the last sign-in. */
export const IDENTITY_MARKER = 'felix.identity';

/**
 * Set by every forget, cleared when the app next opens (`auth.ts` `settleIdentity`). An app still on
 * screen when the identity changes — a turn streaming into the cache, a ledger stamping its visit on
 * the way out — writes after the sweep and before the page unloads, under the new identity's
 * marker. The next open sweeps again, before anything reads.
 */
export const SWEEP_PENDING = 'felix.identity.sweep';

/** localStorage, exactly. */
const LOCAL_KEYS = [
  'felix.threads',
  'felix.threadId',
  'felix.turns',
  'felix.pinnedThreads',
  'felix.durableRuns',
  'felix.manifest',
  'felix.manifestVersions',
  'felix.decidedHere',
  'felix.activity.lastVisit',
  // The in-browser workspace the agent's client tools write files into.
  'felix.chat.vfs',
];
/**
 * localStorage, on sign-out or a change of person only: the tenant a GitHub member of several last
 * chose. A change of tenant alone keeps it, because choosing a tenant *is* one — the device flow
 * stores the choice and then the session for it, and forgetting then would forget the choice just
 * made. A different person must not be signed into the last one's choice without being asked.
 */
const SIGN_OUT_KEYS = ['felix.githubTenant'];
/** localStorage, by prefix: one transcript per thread. */
const LOCAL_PREFIXES = ['felix.turns:'];
/** sessionStorage, exactly: this tab's thread, lease holder and activity window. */
const SESSION_KEYS = ['felix.tabThread', 'felix.holderId', 'felix.activity.sessionSince'];
/** sessionStorage, by prefix: each thread's side pane, unsaved drafts included. */
const SESSION_PREFIXES = ['felix.pane:'];

function sweep(storage: Storage, exact: readonly string[], prefixes: readonly string[]): void {
  const doomed: string[] = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && (exact.includes(key) || prefixes.some((p) => key.startsWith(p)))) doomed.push(key);
  }
  for (const key of doomed) storage.removeItem(key);
}

/**
 * Forget every identity-bound key in both storages, and the local folder the agent was given (its
 * handle in IndexedDB, which a browser that allows the folder on every visit restores silently).
 * `everything` also forgets what a change of tenant keeps (`SIGN_OUT_KEYS`): on sign-out, or when
 * the person changes. Storage that refuses is left as it is.
 */
export function forgetIdentityState({ everything = false }: { everything?: boolean } = {}): void {
  void import('@felix/cowork-client').then(
    (cowork) => cowork.clearMount(),
    () => undefined,
  );
  try {
    sweep(
      localStorage,
      everything ? [...LOCAL_KEYS, ...SIGN_OUT_KEYS] : LOCAL_KEYS,
      LOCAL_PREFIXES,
    );
  } catch {
    // Storage unavailable (private mode): nothing was kept there to leak.
  }
  try {
    sweep(sessionStorage, SESSION_KEYS, SESSION_PREFIXES);
  } catch {
    // As above.
  }
}
