/**
 * The browser's credential for `/api/*`: a session — a bearer the harness minted after a GitHub
 * or Google sign-in (`lib/github-login.ts`), sent as `Authorization: Bearer`. It names a person
 * and the tenant their org maps to, and it lapses on its own — the harness keeps no revocation
 * list, so signing out here forgets the token without cancelling it.
 *
 * There used to be a second kind, the proxy Worker's shared access key, which ran every holder
 * as the deployment. It is gone; `dropLegacyKey` clears the copy a browser may still hold.
 *
 * In `vite dev` the Worker isn't in the loop (Vite proxies `/api` straight to
 * Felix), so the Gate is skipped entirely — see components/gate.tsx.
 */

import { forgetIdentityState, IDENTITY_MARKER, SWEEP_PENDING } from '@/lib/identity-state';

/** Where the retired access key was kept. Read only to be removed. */
const LEGACY_KEY_STORAGE = 'felix.apiKey';
const SESSION_STORAGE = 'felix.session';
/**
 * Which provider this browser last signed in with. Kept past sign-out on purpose — that is when
 * the gate asks — and it names a provider, never an account.
 */
const LAST_PROVIDER_STORAGE = 'felix.lastSignInProvider';

/** Who minted a session's identity: how it is renewed, and whether a GitHub connection can exist. */
export type SignInProvider = 'github' | 'google';

export interface GitHubSession {
  token: string;
  /** Epoch ms. Taken a little early, so a request never leaves with a token about to lapse. */
  expiresAt: number;
  /** The GitHub login; empty from a harness that does not report it. */
  login: string;
  tenant: string;
  scopes: string[];
  /** Absent means GitHub: every session stored before Google sign-in existed was one. */
  provider?: SignInProvider;
  /** A Google session's account, as Google described it at sign-in; shown, never sent. */
  email?: string;
  name?: string;
  /** An https URL on Google's image host, or absent. */
  picture?: string;
}

/**
 * A picture URL as the account chip may draw it: https, on Google's image host. The harness
 * checks this too; it is checked again here because the session is read back from storage, and
 * an `<img src>` is the one place a stored string reaches the network.
 */
export function safePicture(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !url.username && host.endsWith('.googleusercontent.com')
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

/** Which credential a 401 was answering — the gate says something different for each. */
export type CredentialKind = 'session' | 'none';

/**
 * Why the gate is being shown again: a session the harness turned down, or the
 * person choosing to leave.
 */
export type Relock = { cause: 'unauthorized'; kind: CredentialKind } | { cause: 'signed-out' };

let onRelock: ((why: Relock) => void) | null = null;
const listeners = new Set<() => void>();

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage refused (private mode, quota): the credential lives for this page only.
  }
}

function notify(): void {
  for (const fn of listeners) fn();
}

/** Forget an access key stored before the key was retired: a secret nothing reads any more. */
export function dropLegacyKey(): void {
  write(LEGACY_KEY_STORAGE, null);
}

/** A JWT's `sub`, read without verifying it: the harness verified it, this only tells people apart. */
function subjectOf(token: string): string {
  try {
    const part = token.split('.')[1] ?? '';
    const json = atob(part.replace(/-/g, '+').replace(/_/g, '/'));
    const sub = (JSON.parse(json) as { sub?: unknown }).sub;
    return typeof sub === 'string' ? sub : '';
  } catch {
    return '';
  }
}

/**
 * Who a session belongs to, as this browser can tell: its subject (the token's `sub`, else the account the harness reported) in its tenant.
 * Empty with nothing stored. Two sign-ins of one person by two providers are two identities here,
 * as they are to the harness. `|`-separated, since an email carries `@`.
 */
function identityOf(session: GitHubSession | null): string {
  if (!session) return '';
  const account = subjectOf(session.token) || session.login || session.email || '';
  return ['session', session.provider ?? 'github', account, session.tenant].join('|');
}

/** The person an identity names, its tenant aside. */
function personOf(identity: string): string {
  return identity.split('|').slice(0, 3).join('|');
}

/** The identity of what is stored now; see `identityOf`. */
export function identityKey(): string {
  return identityOf(getSession());
}

/**
 * Record that `next` is who this browser now holds state for, first forgetting whatever the last
 * identity left (`forgetIdentityState`) — the choice of a GitHub tenant too, when the person and
 * not only the tenant changed. A browser that has never recorded one keeps what it has: it cannot
 * tell whose that is (`settleIdentity` records it when the app opens).
 */
function takeIdentity(next: string): void {
  const before = read(IDENTITY_MARKER);
  if (before !== null && before !== next) {
    forgetIdentityState({ everything: personOf(before) !== personOf(next) });
    write(SWEEP_PENDING, '1');
  }
  write(IDENTITY_MARKER, next);
}

/**
 * When the app opens, before anything reads its cache: finish a forget the last page could not
 * (`SWEEP_PENDING`), and record whose state this is for a browser signed in before the record was
 * kept, so the next person's sign-in forgets it.
 */
export function settleIdentity(): void {
  if (read(SWEEP_PENDING) !== null) {
    forgetIdentityState();
    write(SWEEP_PENDING, null);
  }
  const now = identityKey();
  if (now && read(IDENTITY_MARKER) === null) write(IDENTITY_MARKER, now);
}

// `useSyncExternalStore` needs the same object back for the same stored value.
let sessionRaw: string | null = null;
let sessionParsed: GitHubSession | null = null;

function parseSession(raw: string | null): GitHubSession | null {
  if (raw === sessionRaw) return sessionParsed;
  sessionRaw = raw;
  sessionParsed = null;
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Partial<GitHubSession>;
    if (
      typeof s.token === 'string' &&
      s.token &&
      typeof s.expiresAt === 'number' &&
      typeof s.tenant === 'string'
    ) {
      sessionParsed = {
        token: s.token,
        expiresAt: s.expiresAt,
        login: typeof s.login === 'string' ? s.login : '',
        tenant: s.tenant,
        scopes: Array.isArray(s.scopes) ? s.scopes.filter((x) => typeof x === 'string') : [],
        provider: s.provider === 'google' ? 'google' : 'github',
        email: typeof s.email === 'string' && s.email ? s.email : undefined,
        name: typeof s.name === 'string' && s.name ? s.name : undefined,
        picture: safePicture(s.picture),
      };
    }
  } catch {
    // Not ours, or from an older shape: treated as absent.
  }
  return sessionParsed;
}

/**
 * The stored session, expired or not. Callers that send it use
 * `activeSession()`; the account chip reads this so it can say *when* it ended.
 */
export function getSession(): GitHubSession | null {
  return parseSession(read(SESSION_STORAGE));
}

/** The stored session if it has not yet expired. */
export function activeSession(now = Date.now()): GitHubSession | null {
  const s = getSession();
  return s && s.expiresAt > now ? s : null;
}

export function setSession(session: GitHubSession): void {
  takeIdentity(identityOf(session));
  write(SESSION_STORAGE, JSON.stringify(session));
  write(LAST_PROVIDER_STORAGE, session.provider ?? 'github');
  notify();
}

/** The provider this browser last signed in with, for the gate's "Last used" badge. */
export function lastSignInProvider(): SignInProvider | null {
  const value = read(LAST_PROVIDER_STORAGE);
  return value === 'github' || value === 'google' ? value : null;
}

export function clearSession(): void {
  write(SESSION_STORAGE, null);
  notify();
}

/** Whether a `storage` event (another tab's write) touched the credential. */
export function isCredentialStorageEvent(e: StorageEvent): boolean {
  return e.key === null || e.key === SESSION_STORAGE;
}

/** For `useSyncExternalStore`. Fires on this tab's own writes and on another tab's. */
export function subscribeCredentials(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (isCredentialStorageEvent(e)) fn();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

export function credentialKind(): CredentialKind {
  return activeSession() ? 'session' : 'none';
}

/** Header merged into every `/api` fetch; empty when nothing is stored. */
export function authHeaders(): Record<string, string> {
  const session = activeSession();
  return session ? { authorization: `Bearer ${session.token}` } : {};
}

/** The Gate registers here so a 401 anywhere, or a sign-out, brings it back. */
export function setRelockHandler(fn: ((why: Relock) => void) | null): void {
  onRelock = fn;
}

/**
 * Called by the API client when a request returns 401. Drops the credential
 * that was refused and notifies the Gate, so the person is asked again instead
 * of seeing a wall of failed requests.
 *
 * `sent` is the credential the refused request carried. When what is stored now differs — another
 * tab signed in, or this one renewed, while the request was on the wire — the refusal was of a
 * credential already gone, and dropping the new one would sign the person out of a session that
 * was never refused.
 */
export function handleUnauthorized(sent?: Record<string, string>): void {
  if (sent && sent.authorization !== authHeaders().authorization) return;
  const kind = credentialKind();
  // An expired session sends nothing, so `credentialKind` reads `none` for it;
  // the stored copy is what says a session is what lapsed.
  const lapsed = kind === 'none' && getSession() !== null ? 'session' : kind;
  write(SESSION_STORAGE, null);
  notify();
  onRelock?.({ cause: 'unauthorized', kind: lapsed });
}

/**
 * Forget the session, and everything this browser kept for it (`forgetIdentityState`), and return
 * to the gate. The token stays valid until it expires: the harness keeps no revocation list.
 * `lib/leave.ts` is what the account chip calls; it lets go of what the session holds on the
 * harness first, while it can still ask.
 */
export function signOut(): void {
  forgetIdentityState({ everything: true });
  write(IDENTITY_MARKER, null);
  write(SWEEP_PENDING, '1');
  clearSession();
  onRelock?.({ cause: 'signed-out' });
}
