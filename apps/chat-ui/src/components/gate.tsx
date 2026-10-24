/**
 * The gate. Wraps the app: until the browser holds a credential the proxy
 * Worker and the harness accept, the chat UI is replaced by a way to get one.
 *
 * Which ways in are offered is decided by the harness rather than by this file:
 *
 * - **GitHub**, when the harness says it serves the device flow
 *   (`GET /auth/methods`). A person, a tenant, a session that lapses.
 * - **Google**, when the harness serves Google sign-in by redirect — only for
 *   the accounts its operator listed. A second button under GitHub's when the
 *   harness offers both.
 *
 * With neither the gate says so, and who can fix it. There used to be a third,
 * the proxy Worker's shared access key, which ran everyone who held it as the
 * deployment; it is gone, and a key a browser still holds is dropped here.
 *
 * A harness that answers an uncredentialed request at all (`FELIX_AUTH_MODE=none`)
 * is open, and the gate opens with it.
 *
 * Skipped in `vite dev`: there the Vite proxy talks to Felix directly with the
 * developer's own key, so there's nothing to gate.
 * That branch lives in main.tsx (so this component's hooks stay unconditional).
 */

import { Spinner } from '@felix/ui/spinner';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AUTH_TIMEOUT_MS, getAuthMethods, githubAuthorizeUrl, primeManifestEntries } from '@/api';
import {
  authHeaders,
  clearSession,
  credentialKind,
  dropLegacyKey,
  getSession,
  identityKey,
  isCredentialStorageEvent,
  lastSignInProvider,
  type Relock,
  setRelockHandler,
  setSession,
  settleIdentity,
  subscribeCredentials,
} from '@/lib/auth';
import {
  completeRedirectSignIn,
  describeFailure,
  redirectToGoogle,
  rememberRedirectProvider,
  returnTo,
  useDeviceLogin,
} from '@/lib/github-login';
import { openFor, reloadHome } from '@/lib/opened-identity';
import { AuthCard, QuietAction } from './auth/auth-card';
import { AuthLayout } from './auth/auth-layout';
import { GitHubSignIn } from './auth/github-sign-in';
import { GoogleButton, GoogleSignIn } from './auth/google-sign-in';

/**
 * `checking` is a stored credential being verified, or the deployment being
 * asked what it offers, and it must draw nothing that looks like a decision. It
 * once rendered the sign-in prompt disabled, so every returning visitor saw the
 * login screen for one round trip before the chat replaced it — a flash that
 * read as "logged out" on a page that was about to open. The prompt is only
 * right once there is nothing that would open the app.
 */
type Phase = 'checking' | 'locked' | 'open';

/** What the deployment accepts from a browser with no credential. */
interface Options {
  github: boolean;
  /** GitHub sign-in by redirect, which leads when the harness offers it. */
  redirect: boolean;
  /** Google sign-in by redirect, for the accounts the harness's operator listed. */
  google: boolean;
  /** A redirect sign-in came back `tenant_ambiguous`: the tenants to choose between. */
  tenants?: string[];
  /** Whether the harness admits invited accounts from outside its organizations. */
  signup?: 'off' | 'invite';
}

/**
 * How long the check may run before the holding surface admits it is waiting.
 * A probe that returns inside this shows nothing at all, which is the point:
 * a spinner that appears for 80ms and vanishes is itself a flash. Past it, a
 * slow proxy gets a "still working" signal rather than a blank page.
 */
const HOLDING_SPINNER_DELAY_MS = 400;

/**
 * The full-viewport surface drawn while a stored session is checked. Same box as
 * <AuthLayout /> (`min-h-svh bg-background`) so the swap to either the app or
 * the prompt does not shift the page behind it.
 */
function Holding() {
  const [waiting, setWaiting] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setWaiting(true), HOLDING_SPINNER_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <div className="flex min-h-svh w-full items-center justify-center bg-background">
      {waiting && <Spinner className="size-5 text-muted-foreground" />}
    </div>
  );
}

/**
 * Why the probe carries a reason rather than a boolean: a swallowed network
 * error and a rejected credential both used to collapse into `false`, so a
 * laptop that woke up offline showed the prompt with no message at all —
 * identical to a sign-in that had ended, and wrong about whose fault it was.
 */
type Probe =
  | { ok: true }
  | {
      ok: false;
      reason: 'rejected' | 'offline' | 'timeout' | 'unconfigured' | 'error';
      status?: number;
    };

/** One request through the cheapest authenticated route, with whatever is stored. */
async function probe(): Promise<Probe> {
  let res: Response;
  try {
    // The API client's own header builder, so the gate checks exactly what
    // every later request will send.
    res = await fetch('/api/v1/models', {
      headers: authHeaders(),
      signal: AbortSignal.timeout(AUTH_TIMEOUT_MS),
    });
  } catch (e) {
    // A deadline that lapsed is not a dropped network: the server took the request and sat on
    // it, and "check your connection" would send the person to the wrong place.
    const timedOut = e instanceof DOMException && e.name === 'TimeoutError';
    return { ok: false, reason: timedOut ? 'timeout' : 'offline' };
  }
  if (res.ok) {
    // The shell's agent picker reads this same route next; it takes this answer instead.
    primeManifestEntries(res);
    return { ok: true };
  }
  if (res.status === 401) return { ok: false, reason: 'rejected' };
  if (res.status === 502) {
    // The Worker's own "I have no upstream" reply. Worth separating: no sign-in
    // will ever fix it, and the reader of this screen is the one who deploys.
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    if (body?.error === 'felix_origin_unset') return { ok: false, reason: 'unconfigured' };
  }
  return { ok: false, reason: 'error', status: res.status };
}

/**
 * Drop the stored session once it has been refused, and only then: a stored session that failed
 * its check on load would otherwise be probed again on every reload. Offline and every other
 * failure keep it: those say nothing about the session, and dropping it would make a laptop that
 * woke up without a network ask for a sign-in that was fine.
 */
function forgetIfRejected(result: Extract<Probe, { ok: false }>): void {
  if (result.reason === 'rejected') clearSession();
}

const SIGN_IN_ENDED = 'Your sign-in has ended. Sign in again.';

/**
 * What a relock says. A request that carried no credential refused nothing — it went out after a
 * sign-out, a lease letting go on the way down — so it says nothing, rather than telling a person
 * who just signed out that their sign-in ended.
 */
function relockMessage(why: Relock): string | null {
  if (why.cause === 'signed-out' || why.kind === 'none') return null;
  return SIGN_IN_ENDED;
}

function probeMessage(result: Extract<Probe, { ok: false }>): string {
  switch (result.reason) {
    case 'rejected':
      return SIGN_IN_ENDED;
    case 'offline':
      return 'Could not reach the server. Check your connection and try again.';
    case 'timeout':
      return 'The server did not answer in time. Try again in a moment.';
    case 'unconfigured':
      return 'The proxy is not configured — FELIX_ORIGIN is unset.';
    default:
      return `Could not verify your sign-in (${result.status}).`;
  }
}

type Check =
  | { open: true; notice?: string | null }
  | { open: false; error: string | null; options: Options };

/**
 * Verify what is stored; failing that, ask the deployment what it offers. An
 * expired session is not sent at all, so it is reported here rather than spent
 * on a request.
 */
async function check(): Promise<Check> {
  let error: string | null = null;
  dropLegacyKey();
  // The return from a redirect sign-in, if this load is one: store what it brought, or say why
  // it brought nothing, before anything else is asked.
  let tenants: string[] | undefined;
  const returned = await completeRedirectSignIn();
  if (returned.kind === 'signed-in') setSession(returned.session);
  else if (returned.kind === 'failed') {
    error = describeFailure(returned.failure, undefined, returned.login).message;
    tenants = returned.tenants;
    if (tenants?.length) error = null;
  }
  let kind = credentialKind();
  if (kind === 'none' && getSession()) {
    clearSession();
    error = SIGN_IN_ENDED;
  }
  // Whether the harness has already said no to this browser, so asking again with nothing
  // would only hear it twice.
  let refused = false;
  if (kind !== 'none') {
    const result = await probe();
    // A redirect sign-in that failed while a session was still stored opens on that session, but
    // says so: the person meant to renew, or to switch, and would otherwise believe they had.
    if (result.ok) return { open: true, notice: error };
    forgetIfRejected(result);
    error = probeMessage(result);
    refused = result.reason === 'rejected';
    kind = credentialKind();
  }
  // Ask with nothing stored: an open deployment answers. A session that could not be checked
  // (offline) is kept and not re-sent.
  const [anonymous, methods] = await Promise.all([
    kind === 'none' && !refused ? probe() : Promise.resolve(null),
    getAuthMethods(),
  ]);
  if (anonymous?.ok) return { open: true };
  // A refusal of nobody is what the sign-in prompt below already says.
  if (anonymous && anonymous.reason !== 'rejected') error ??= probeMessage(anonymous);
  return {
    open: false,
    error,
    options: {
      github: methods?.github_device === true || methods?.github_redirect === true,
      redirect: methods?.github_redirect === true,
      google: methods?.google_redirect === true,
      tenants,
      signup: methods?.github_signup ?? 'off',
    },
  };
}

export function Gate({ children }: { children: ReactNode }) {
  const [phase, setPhase] = useState<Phase>('checking');
  const [options, setOptions] = useState<Options>({
    github: false,
    redirect: false,
    google: false,
  });
  const [error, setError] = useState<string | null>(null);

  const login = useDeviceLogin(
    useCallback((session) => {
      setSession(session);
      setError(null);
      setPhase('open');
    }, []),
  );
  const { cancel } = login;

  useEffect(() => {
    setRelockHandler((why: Relock) => {
      setError(relockMessage(why));
      cancel();
      setPhase('checking');
    });
    return () => setRelockHandler(null);
  }, [cancel]);

  useEffect(() => {
    if (phase !== 'checking') return;
    let alive = true;
    check()
      .then((result) => {
        if (!alive) return;
        if (result.open) {
          if (result.notice) toast.error(result.notice);
          setPhase('open');
          return;
        }
        // A relock's own message outranks the check's silence about it.
        if (result.error) setError(result.error);
        setOptions(result.options);
        setPhase('locked');
      })
      .catch(() => {
        // Nothing in `check` is meant to throw; if something does, the holding surface would
        // spin for good. Fall to the prompt with the options as they stand, and say so.
        if (!alive) return;
        setError('Could not check how to sign in. Reload the page to try again.');
        setPhase('locked');
      });
    return () => {
      alive = false;
    };
  }, [phase]);

  // A locked gate is a picture of one moment, and two things outdate it without the person
  // doing anything here: the network coming back, after a check that could not reach the
  // server, and another tab signing in, which writes the credential this one is asking for.
  // Either way, check again. Not mid-flow — a code on screen is the person's, and re-drawing
  // the card would take it from them.
  const idle = login.state.phase === 'idle' || login.state.phase === 'failed';
  useEffect(() => {
    if (phase !== 'locked' || !idle) return;
    const recheck = () => {
      setError(null);
      setPhase('checking');
    };
    // `storage` fires only for another tab's writes, never this one's.
    const onStorage = () => {
      if (credentialKind() !== 'none') recheck();
    };
    window.addEventListener('online', recheck);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('online', recheck);
      window.removeEventListener('storage', onStorage);
    };
  }, [phase, idle]);

  if (phase === 'open') return <Opened>{children}</Opened>;
  if (phase === 'checking') return <Holding />;

  const toGoogle = redirectToGoogle;

  // Only worth marking where there is a choice to make.
  const last = options.github && options.google ? lastSignInProvider() : null;

  let card: ReactNode;
  if (options.github) {
    card = (
      <GitHubSignIn
        login={login}
        error={error}
        redirect={
          options.redirect
            ? (tenant?: string) => {
                rememberRedirectProvider('github');
                window.location.assign(githubAuthorizeUrl(returnTo(), tenant));
              }
            : undefined
        }
        tenants={options.tenants}
        signup={options.signup}
        google={
          options.google ? (
            <GoogleButton
              redirect={toGoogle}
              variant={last === 'google' ? 'default' : 'outline'}
              lastUsed={last === 'google'}
            />
          ) : undefined
        }
        lastUsed={last === 'github'}
        secondary={last === 'google'}
      />
    );
  } else if (options.google) {
    card = <GoogleSignIn error={error} redirect={toGoogle} />;
  } else {
    card = (
      <NoWayIn
        error={error}
        onRetry={() => {
          setError(null);
          setPhase('checking');
        }}
      />
    );
  }

  return <AuthLayout>{card}</AuthLayout>;
}

/**
 * No way in exists: the harness refuses an anonymous caller and serves no
 * GitHub or Google login. Nothing a visitor does fixes that, so the card says
 * who can.
 */
function NoWayIn({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  // Fixing it is a deploy, not a reload of this page; the button saves the person from
  // wondering whether the page would notice.
  return (
    <AuthCard footer={<QuietAction onClick={onRetry}>Check again</QuietAction>}>
      {error && (
        <p role="alert" className="text-sm text-state-failed">
          {error}
        </p>
      )}
      <p className="text-sm text-muted-foreground">
        This deployment offers no way to sign in from a browser. Whoever runs it can turn on GitHub
        or Google login on the harness.
      </p>
    </AuthCard>
  );
}

/**
 * The guarded app, for as long as the identity it opened for is the one stored. Another identity
 * stored under it — another tab signing out or in as someone else, or a sign-in here that did not
 * reload — would have requests carry the new credential while the screen still shows the old
 * person's thread, approvals and leases. So it reloads to `/` instead, where the gate asks or
 * opens for whoever is stored now.
 */
function Opened({ children }: { children: ReactNode }) {
  const [opened] = useState(() => {
    const now = identityKey();
    const stale = openFor(now);
    // Before the app below reads its cache: finish a forget the last page left, record whose this is.
    if (!stale) settleIdentity();
    return { now, stale };
  });
  useEffect(() => {
    if (opened.stale) {
      reloadHome();
      return;
    }
    // Once: another tab's write reaches both listeners below.
    let leaving = false;
    const away = () => {
      if (leaving) return;
      leaving = true;
      reloadHome();
    };
    // This tab's own writes: a credential cleared here is a relock, the gate's to handle with its
    // message; a different identity stored here (a device-flow sign-in from the chip) is not.
    const unsubscribe = subscribeCredentials(() => {
      const now = identityKey();
      if (now && now !== opened.now) away();
    });
    // Another tab's: signing out there, or in as someone else, must not leave this tab showing
    // the last person's thread.
    const onStorage = (e: StorageEvent) => {
      if (isCredentialStorageEvent(e) && identityKey() !== opened.now) away();
    };
    window.addEventListener('storage', onStorage);
    return () => {
      unsubscribe();
      window.removeEventListener('storage', onStorage);
    };
  }, [opened]);
  if (opened.stale) return null;
  return <>{children}</>;
}
