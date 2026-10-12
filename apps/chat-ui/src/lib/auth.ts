/**
 * The browser's credential for `/api/*` — one of two kinds, never both.
 *
 * - **An access key**: the proxy Worker's shared `CHAT_UI_KEY`, sent as
 *   `x-chat-key`. Every holder is the same principal.
 * - **A session**: a bearer the harness minted after a GitHub or Google sign-in
 *   (`lib/github-login.ts`), sent as `Authorization: Bearer`. It names a
 *   person and the tenant their org maps to, and it lapses on its own — the
 *   harness keeps no revocation list, so signing out here forgets the token
 *   without cancelling it.
 *
 * Storing one clears the other, so a request never carries both: the Worker
 * would honour the key and silently drop the person.
 *
 * In `vite dev` the Worker isn't in the loop (Vite proxies `/api` straight to
 * Felix), so the Gate is skipped entirely — see components/gate.tsx.
 */

const KEY_STORAGE = 'felix.apiKey';
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
export type CredentialKind = 'key' | 'session' | 'none';

/**
 * Why the gate is being shown again: a credential the harness or Worker turned
 * down, or the person choosing to leave.
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

export function getApiKey(): string | null {
  return read(KEY_STORAGE);
}

export function setApiKey(key: string): void {
  write(SESSION_STORAGE, null);
  write(KEY_STORAGE, key);
  notify();
}

export function clearApiKey(): void {
  write(KEY_STORAGE, null);
  notify();
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
  write(KEY_STORAGE, null);
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

/** For `useSyncExternalStore`. Fires on this tab's own writes and on another tab's. */
export function subscribeCredentials(fn: () => void): () => void {
  listeners.add(fn);
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key === KEY_STORAGE || e.key === SESSION_STORAGE) fn();
  };
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(fn);
    window.removeEventListener('storage', onStorage);
  };
}

export function credentialKind(): CredentialKind {
  if (activeSession()) return 'session';
  if (getApiKey()) return 'key';
  return 'none';
}

/** Header merged into every `/api` fetch; empty when nothing is stored. */
export function authHeaders(): Record<string, string> {
  const session = activeSession();
  if (session) return { authorization: `Bearer ${session.token}` };
  const key = getApiKey();
  return key ? { 'x-chat-key': key } : {};
}

/** The Gate registers here so a 401 anywhere, or a sign-out, brings it back. */
export function setRelockHandler(fn: ((why: Relock) => void) | null): void {
  onRelock = fn;
}

/**
 * Called by the API client when a request returns 401. Drops the credential
 * that was refused and notifies the Gate, so the person is asked again instead
 * of seeing a wall of failed requests.
 */
export function handleUnauthorized(): void {
  const kind = credentialKind();
  // An expired session sends nothing, so `credentialKind` reads `none` for it;
  // the stored copy is what says a session is what lapsed.
  const lapsed = kind === 'none' && getSession() !== null ? 'session' : kind;
  write(KEY_STORAGE, null);
  write(SESSION_STORAGE, null);
  notify();
  onRelock?.({ cause: 'unauthorized', kind: lapsed });
}

/** Forget the session and return to the gate. The token stays valid until it expires. */
export function signOut(): void {
  clearSession();
  onRelock?.({ cause: 'signed-out' });
}
