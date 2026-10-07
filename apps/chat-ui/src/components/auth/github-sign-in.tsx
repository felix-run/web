/**
 * GitHub sign-in, as the gate's card and as the body of the account chip's
 * renewal. Presentational over `useDeviceLogin`: it draws the flow's state and
 * calls its verbs, and owns nothing but the clipboard and a clock.
 *
 * The code is the one thing on screen while the flow waits, because it is the
 * one thing the person has to carry somewhere else: large, monospaced (it is
 * transcribed character by character), selectable whole, with a copy beside it.
 * Opening GitHub copies it too, so on a phone the round trip is open, paste,
 * approve, come back.
 */

import { Button } from '@felix/ui/button';
import { Spinner } from '@felix/ui/spinner';
import { CheckIcon, CopyIcon, ExternalLinkIcon, Loader2Icon } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { type DeviceLogin, describeFailure } from '@/lib/github-login';

/** GitHub's mark, from its own octicon. Used only on the control that signs in with it. */
export function GitHubMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" fill="currentColor" className={className}>
      <path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z" />
    </svg>
  );
}

function useNow(ms: number, on: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!on) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms, on]);
  return now;
}

function clock(msLeft: number): string {
  const s = Math.max(0, Math.ceil(msLeft / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** The verification page without its scheme, which is what a person reads and types. */
function bareUrl(uri: string): string {
  return uri.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

/**
 * The flow from the first click to the last refusal. `idle` is the caller's to
 * draw — the gate shows its button, the chip its own — so it renders `idle`.
 */
export function DeviceLoginBody({ login, idle }: { login: DeviceLogin; idle: ReactNode }) {
  const { state, start, cancel } = login;
  const waiting = state.phase === 'waiting' ? state : null;
  const now = useNow(1000, waiting !== null);
  const [copied, setCopied] = useState(false);

  // Each new code starts uncopied.
  const userCode = waiting?.code.user_code;
  useEffect(() => {
    if (userCode) setCopied(false);
  }, [userCode]);

  if (state.phase === 'idle' || state.phase === 'starting') return <>{idle}</>;

  if (state.phase === 'done') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" />
        Signed in.
      </p>
    );
  }

  if (state.phase === 'waiting') {
    const { code, expiresAt } = state;
    const copyCode = async () => setCopied(await copy(code.user_code));
    return (
      <div className="space-y-5">
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">
            Enter this code at{' '}
            <span className="text-foreground">{bareUrl(code.verification_uri)}</span>
          </p>
          <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted px-4 py-3">
            <output
              aria-label={`Code ${code.user_code.split('').join(' ')}`}
              className="select-all font-mono text-2xl font-semibold tabular-nums tracking-[0.18em]"
            >
              {code.user_code}
            </output>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={copyCode}
              aria-label={copied ? 'Code copied' : 'Copy code'}
              title={copied ? 'Copied' : 'Copy code'}
            >
              {copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
            </Button>
          </div>
        </div>

        <Button asChild className="h-10 w-full">
          <a
            href={code.verification_uri}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => void copyCode()}
          >
            Open GitHub
            <ExternalLinkIcon className="size-4" />
          </a>
        </Button>

        <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
          <p role="status" className="flex items-center gap-2">
            <Loader2Icon aria-hidden className="size-3.5 animate-spin" />
            Waiting for you to approve on GitHub
          </p>
          <span className="tabular-nums" title="This code stops working after this">
            {clock(expiresAt - now)}
          </span>
        </div>

        <button
          type="button"
          onClick={cancel}
          className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Cancel
        </button>
      </div>
    );
  }

  if (state.phase === 'choose-tenant') {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Your organizations open more than one tenant. Choose one, and GitHub will ask you to
          approve once more.
        </p>
        <ul className="space-y-2">
          {state.tenants.map((tenant) => (
            <li key={tenant}>
              <Button
                type="button"
                variant="outline"
                className="h-10 w-full justify-start font-mono"
                onClick={() => void start(tenant)}
              >
                {tenant}
              </Button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={cancel}
          className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Cancel
        </button>
      </div>
    );
  }

  const { message, retry } = describeFailure(state.failure, state.status, state.login);
  return (
    <div className="space-y-4">
      <p role="alert" className="text-sm text-state-failed">
        {message}
      </p>
      {retry && (
        <Button
          type="button"
          variant="outline"
          className="h-10 w-full"
          onClick={() => void start()}
        >
          {retry}
        </Button>
      )}
    </div>
  );
}

/** The gate's card when the harness offers GitHub login. `alternative` is the access-key way in. */
export function GitHubSignIn({
  login,
  error,
  redirect,
  tenants,
  signup = 'off',
  alternative,
}: {
  login: DeviceLogin;
  error: string | null;
  /** Sign in by redirect instead of a code; given a tenant, sign in to that one. */
  redirect?: (tenant?: string) => void;
  /** A redirect sign-in found several tenants: offer one button each. */
  tenants?: string[];
  /** Whether an account in no admitted organization may sign in, by invitation. */
  signup?: 'off' | 'invite';
  alternative?: ReactNode;
}) {
  // A redirect leaves the page, but not at once: hold the button until it does.
  // Which tenant was asked for, or '' for none, so only that button spins.
  const [redirecting, setRedirecting] = useState<string | null>(null);
  useEffect(() => {
    // Back from GitHub restores this page from the back/forward cache, state and all.
    const reset = (e: PageTransitionEvent) => e.persisted && setRedirecting(null);
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);
  const go = (tenant?: string) => {
    setRedirecting(tenant ?? '');
    redirect?.(tenant);
  };
  const starting = login.state.phase === 'starting';
  const busy = starting || redirecting !== null;
  return (
    <div className="w-full max-w-sm space-y-6 rounded-lg border border-border bg-card p-6">
      <div className="space-y-1.5">
        <h1 className="text-base font-semibold">
          <span className="uppercase tracking-wider">Felix</span> chat
        </h1>
        <p className="text-sm text-muted-foreground">
          {signup === 'invite'
            ? 'Sign in with GitHub. Felix is invite-only for now.'
            : 'Sign in with the GitHub account your organization uses.'}
        </p>
      </div>

      <DeviceLoginBody
        login={login}
        idle={
          <div className="space-y-3">
            {error && (
              <p role="alert" className="text-sm text-state-failed">
                {error}
              </p>
            )}
            {redirect && tenants && tenants.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">
                  Your organizations open more than one tenant. Choose the one to sign in to.
                </p>
                <ul className="space-y-2">
                  {tenants.map((tenant) => (
                    <li key={tenant}>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 w-full justify-start font-mono"
                        disabled={busy}
                        aria-busy={redirecting === tenant}
                        onClick={() => go(tenant)}
                      >
                        {redirecting === tenant && <Loader2Icon className="size-4 animate-spin" />}
                        {tenant}
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button
              type="button"
              className="h-10 w-full"
              disabled={busy}
              aria-busy={starting || redirecting === ''}
              onClick={() => (redirect ? go() : void login.start())}
            >
              {starting || redirecting === '' ? (
                <Loader2Icon className="size-4 animate-spin" />
              ) : (
                <GitHubMark className="size-4" />
              )}
              {starting
                ? 'Asking GitHub for a code…'
                : redirecting === ''
                  ? 'Opening GitHub…'
                  : 'Continue with GitHub'}
            </Button>
            <p className="text-xs text-muted-foreground">
              {signup === 'invite'
                ? 'A member of an organization Felix admits signs in to that organization’s tenant; an invited account gets a tenant of its own.'
                : 'Felix checks which of your GitHub organizations it admits and signs you in to that organization’s tenant.'}{' '}
              Anything it keeps from GitHub, you can revoke from the account menu.
            </p>
          </div>
        }
      />

      {alternative && <div className="border-t border-border/60 pt-4">{alternative}</div>}
    </div>
  );
}
