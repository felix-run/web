/**
 * Signing in with GitHub: the harness's device flow, driven from the page.
 *
 * There is no redirect. The harness asks GitHub for a short code, the person
 * types it at github.com/login/device, and this polls `POST /auth/github/token`
 * until GitHub says they approved — at which point the harness checks which of
 * their orgs it admits and mints a Felix bearer for that org's tenant. The
 * GitHub token itself never reaches the page.
 *
 * The flow runs in place, which is the point of it being a hook rather than a
 * page: the gate uses it to let someone in, and the account chip uses it to
 * renew a session *without* unmounting the shell, so a live run survives.
 *
 * A device code is single-use. When the person's orgs map to more than one
 * tenant the harness answers `tenant_ambiguous` only after GitHub has approved,
 * so choosing a tenant means a second code; the choice is remembered so the
 * next sign-in asks once.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  exchangeGitHubLogin,
  type GitHubDeviceStart,
  type GitHubLoginToken,
  type LoginResult,
  redeemGitHubLogin,
  startGitHubLogin,
} from '@/api';
import type { GitHubSession } from './auth';

const TENANT_STORAGE = 'felix.githubTenant';

/** Taken off the token's lifetime, so a request never leaves with one about to lapse. */
const EXPIRY_MARGIN_MS = 60_000;

/** The longest a poll waits after a network failure; it keeps trying until the code expires. */
const MAX_OFFLINE_BACKOFF_S = 30;

export type LoginFailure =
  | 'expired'
  | 'denied'
  | 'not-member'
  | 'restricted'
  | 'tenant-not-granted'
  | 'rate-limited'
  | 'unavailable'
  | 'misconfigured'
  | 'disabled'
  | 'offline'
  | 'stale'
  | 'unknown';

export type LoginState =
  | { phase: 'idle' }
  | { phase: 'starting' }
  | { phase: 'waiting'; code: GitHubDeviceStart; expiresAt: number; tenant?: string }
  | { phase: 'choose-tenant'; tenants: string[] }
  | { phase: 'failed'; failure: LoginFailure; status?: number }
  | { phase: 'done' };

/** What the card says, and whether trying again could help. */
export function describeFailure(
  failure: LoginFailure,
  status?: number,
): {
  message: string;
  retry: string | null;
} {
  switch (failure) {
    case 'expired':
      return { message: 'The code expired before it was approved.', retry: 'Get a new code' };
    case 'stale':
      // A redirect sign-in whose state this browser no longer holds: it expired on GitHub's
      // screen, or it was started in another window.
      return {
        message: 'That sign-in expired or was started in another window.',
        retry: 'Sign in again',
      };
    case 'denied':
      return { message: 'Sign-in was cancelled on GitHub.', retry: 'Try again' };
    case 'not-member':
      return {
        message:
          'That GitHub account is not in an organization this deployment admits. Ask whoever runs it which one to join.',
        retry: 'Try another account',
      };
    case 'restricted':
      return {
        message:
          'Your organization restricts third-party apps and has not approved this one. An organization owner can approve it in GitHub’s OAuth app settings.',
        retry: 'Try again',
      };
    case 'tenant-not-granted':
      return {
        message: 'That tenant is no longer open to your account.',
        retry: 'Choose again',
      };
    case 'rate-limited':
      return {
        message: 'Too many sign-ins were started from here. Try again in a while.',
        retry: 'Try again',
      };
    case 'unavailable':
      return { message: 'GitHub could not be reached. Try again in a moment.', retry: 'Try again' };
    case 'misconfigured':
      return {
        message:
          'GitHub sign-in is misconfigured on the harness. Whoever runs it will find the cause in its log.',
        retry: null,
      };
    case 'disabled':
      return { message: 'GitHub sign-in is not turned on for this harness.', retry: null };
    case 'offline':
      return {
        message: 'Could not reach the server. Check your connection and try again.',
        retry: 'Try again',
      };
    default:
      return { message: `Sign-in failed${status ? ` (${status})` : ''}.`, retry: 'Try again' };
  }
}

/** A harness refusal code (`not_a_member`, …) as the failure the card describes. */
export function failureFromCode(code: string | undefined, status?: number): LoginFailure {
  switch (code) {
    case 'expired_token':
    case 'invalid_device_code':
      return 'expired';
    case 'state_mismatch':
    case 'sign_in_expired':
      return 'stale';
    case 'access_denied':
      return 'denied';
    case 'not_a_member':
      return 'not-member';
    case 'org_access_restricted':
      return 'restricted';
    case 'tenant_not_granted':
      return 'tenant-not-granted';
    case 'rate_limited':
      return 'rate-limited';
    case 'github_unavailable':
      return 'unavailable';
    case 'github_config_error':
      return 'misconfigured';
  }
  if (status === 404) return 'disabled';
  if (status === 429) return 'rate-limited';
  return 'unknown';
}

function failureOf(result: Extract<LoginResult<unknown>, { ok: false }>): LoginFailure {
  return failureFromCode(result.refusal?.error, result.status);
}

function rememberedTenant(): string | undefined {
  try {
    return localStorage.getItem(TENANT_STORAGE) ?? undefined;
  } catch {
    return undefined;
  }
}

function rememberTenant(tenant: string | null): void {
  try {
    if (tenant === null) localStorage.removeItem(TENANT_STORAGE);
    else localStorage.setItem(TENANT_STORAGE, tenant);
  } catch {
    // Not remembered; the next sign-in asks again.
  }
}

export function sessionFrom(token: GitHubLoginToken, now = Date.now()): GitHubSession {
  return {
    token: token.access_token,
    expiresAt: now + Math.max(0, token.expires_in * 1000 - EXPIRY_MARGIN_MS),
    login: token.github_login ?? '',
    tenant: token.tenant,
    scopes: token.scopes ?? [],
  };
}

export type RedirectOutcome =
  | { kind: 'none' }
  | { kind: 'signed-in'; session: GitHubSession }
  | { kind: 'failed'; failure: LoginFailure; tenants?: string[] };

/**
 * Finish a redirect sign-in, if this page load is the return from one.
 *
 * The harness comes back with a fragment — `#felix_login=ok`, or `#felix_login_error=<code>`
 * (plus `tenants=` for an ambiguous membership) — and, on success, the token waiting in an
 * HttpOnly cookie that `exchangeGitHubLogin` collects once. The fragment is cleared from the
 * address at once, whatever it said, so a reload, a bookmark or a Back never replays it.
 */
export async function completeRedirectSignIn(): Promise<RedirectOutcome> {
  const hash = typeof window === 'undefined' ? '' : window.location.hash.replace(/^#/, '');
  if (!hash) return { kind: 'none' };
  const params = new URLSearchParams(hash);
  const ok = params.get('felix_login');
  const error = params.get('felix_login_error');
  if (ok === null && error === null) return { kind: 'none' };
  window.history.replaceState(
    window.history.state,
    '',
    `${window.location.pathname}${window.location.search}`,
  );
  if (error !== null) {
    const tenants = params.get('tenants');
    return {
      kind: 'failed',
      failure: failureFromCode(error),
      tenants: tenants ? tenants.split(',').filter(Boolean) : undefined,
    };
  }
  let result: LoginResult<GitHubLoginToken>;
  try {
    result = await exchangeGitHubLogin();
  } catch {
    return { kind: 'failed', failure: 'offline' };
  }
  if (!result.ok)
    return { kind: 'failed', failure: failureFromCode(result.refusal?.error, result.status) };
  return { kind: 'signed-in', session: sessionFrom(result.value) };
}

export function useDeviceLogin(onSignedIn: (session: GitHubSession) => void) {
  const [state, setState] = useState<LoginState>({ phase: 'idle' });
  // Bumped by every start and cancel, so an answer to a flow nobody is waiting
  // on any more cannot move the state.
  const generation = useRef(0);
  const signedIn = useRef(onSignedIn);
  signedIn.current = onSignedIn;

  const start = useCallback(async (tenant?: string) => {
    const gen = ++generation.current;
    setState({ phase: 'starting' });
    let result: LoginResult<GitHubDeviceStart>;
    try {
      result = await startGitHubLogin();
    } catch {
      if (gen === generation.current) setState({ phase: 'failed', failure: 'offline' });
      return;
    }
    if (gen !== generation.current) return;
    if (!result.ok) {
      setState({ phase: 'failed', failure: failureOf(result), status: result.status });
      return;
    }
    setState({
      phase: 'waiting',
      code: result.value,
      expiresAt: Date.now() + result.value.expires_in * 1000,
      tenant: tenant ?? rememberedTenant(),
    });
  }, []);

  const cancel = useCallback(() => {
    generation.current += 1;
    setState({ phase: 'idle' });
  }, []);

  const waiting = state.phase === 'waiting' ? state : null;

  useEffect(() => {
    if (!waiting) return;
    const gen = generation.current;
    const { code, expiresAt, tenant } = waiting;
    let interval = Math.max(1, code.interval);
    let misses = 0;
    let timer: number | undefined;
    const live = () => gen === generation.current;

    // A timer is all that is needed for a phone that leaves for GitHub: a
    // backgrounded page's timers freeze, and the overdue one fires the moment
    // it is foregrounded, which is the poll that finds the approval.
    const schedule = (seconds: number) => {
      timer = window.setTimeout(poll, seconds * 1000);
    };

    async function poll() {
      if (!live()) return;
      if (Date.now() >= expiresAt) {
        setState({ phase: 'failed', failure: 'expired' });
        return;
      }
      let result: LoginResult<GitHubLoginToken>;
      try {
        result = await redeemGitHubLogin(code.device_code, tenant);
      } catch {
        // Offline for a moment — switching apps on a phone does this. The code
        // is still good, so keep asking, more slowly, until it expires.
        misses += 1;
        if (live()) schedule(Math.min(interval * 2 ** misses, MAX_OFFLINE_BACKOFF_S));
        return;
      }
      if (!live()) return;
      misses = 0;
      if (result.ok) {
        if (tenant) rememberTenant(tenant);
        generation.current += 1;
        setState({ phase: 'done' });
        signedIn.current(sessionFrom(result.value));
        return;
      }
      const refusal = result.refusal;
      if (refusal?.error === 'authorization_pending') {
        schedule(interval);
        return;
      }
      if (refusal?.error === 'slow_down') {
        // GitHub's own answer to polling too fast: its new interval, or five more.
        interval = refusal.interval ?? interval + 5;
        schedule(interval);
        return;
      }
      if (refusal?.error === 'tenant_ambiguous' && refusal.tenants?.length) {
        setState({ phase: 'choose-tenant', tenants: refusal.tenants });
        return;
      }
      const failure = failureOf(result);
      // A remembered tenant the account has lost: forget it, so trying again
      // asks rather than failing the same way.
      if (failure === 'tenant-not-granted') rememberTenant(null);
      setState({ phase: 'failed', failure, status: result.status });
    }

    schedule(interval);
    return () => window.clearTimeout(timer);
  }, [waiting]);

  return { state, start, cancel };
}

export type DeviceLogin = ReturnType<typeof useDeviceLogin>;
