/**
 * Who this browser is signed in as, when it signed in with GitHub or Google. Nothing at
 * all under the shared access key, which names no one.
 *
 * Quiet by design: a face and a login at the end of the header, so the person
 * and the tenant are findable without being a thing the eye keeps landing on.
 * It earns the state colour in one case only — the session is about to end —
 * because the harness keeps no refresh and no revocation, so an ended session
 * is a 401 on the next request and a gate in front of whatever run was live.
 * Renewing happens here: a GitHub session in the popover, with the shell still
 * mounted; a Google session by redirect, since Google has no code to enter in
 * place, coming back to the same page.
 *
 * Signing out forgets the token and everything this browser kept for it (`lib/leave.ts`). The
 * harness cannot be told to stop honouring the token, so the popover says until when it still
 * would, rather than implying that leaving cancelled it.
 */

import { Avatar, AvatarFallback, AvatarImage } from '@felix/ui/avatar';
import { Button } from '@felix/ui/button';
import { cn } from '@felix/ui/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@felix/ui/popover';
import { RefreshCwIcon } from 'lucide-react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { type GitHubConnectionState, getGitHubConnection, removeGitHubConnection } from '@/api';
import { type GitHubSession, getSession, setSession, subscribeCredentials } from '@/lib/auth';
import { redirectToGoogle, useDeviceLogin } from '@/lib/github-login';
import { leave } from '@/lib/leave';
import { DeviceLoginBody } from './auth/github-sign-in';
import { GoogleButton } from './auth/google-sign-in';
import { ConfirmButton } from './confirm-button';

/** From here to the end, the chip says the session is ending and offers to renew it. */
export const RENEW_WINDOW_MS = 15 * 60_000;

function useMinuteClock(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function timeOfDay(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function minutesLeft(ms: number): number {
  return Math.max(0, Math.ceil(ms / 60_000));
}

/** Who a session is, in words: a Google name or email, a GitHub @login, else the tenant. */
function displayName(session: GitHubSession): string {
  if (session.provider === 'google') return session.name || session.email || session.tenant;
  return session.login ? `@${session.login}` : session.tenant;
}

/** The face: Google's picture, a GitHub avatar, or the first letter of the name. */
function avatarSrc(session: GitHubSession): string | undefined {
  if (session.provider === 'google') return session.picture;
  return session.login
    ? `https://github.com/${encodeURIComponent(session.login)}.png?size=64`
    : undefined;
}

function Face({ session, className }: { session: GitHubSession; className?: string }) {
  const name = displayName(session).replace(/^@/, '');
  const src = avatarSrc(session);
  return (
    <Avatar className={className}>
      {src && <AvatarImage src={src} alt="" referrerPolicy="no-referrer" />}
      <AvatarFallback className="text-xs font-semibold uppercase">
        {name.slice(0, 1)}
      </AvatarFallback>
    </Avatar>
  );
}

export function AccountChip() {
  const session = useSyncExternalStore(subscribeCredentials, getSession);
  const now = useMinuteClock();
  const [open, setOpen] = useState(false);

  const login = useDeviceLogin(
    useCallback((next: GitHubSession) => {
      const before = getSession();
      setSession(next);
      // Threads are tenant-scoped: carrying the open one into another tenant
      // would address a conversation that does not exist there.
      if (before && before.tenant !== next.tenant) window.location.assign('/');
    }, []),
  );
  const { state, cancel } = login;

  // A finished renewal goes back to rest, ready for the next one.
  useEffect(() => {
    if (state.phase === 'done') cancel();
  }, [state.phase, cancel]);

  if (!session) return null;

  const left = session.expiresAt - now;
  const ending = left < RENEW_WINDOW_MS;
  const who = displayName(session);
  // The chip's own label: short, so a first name rather than a whole one.
  const label = session.provider === 'google' ? session.name?.split(/\s+/)[0] : session.login;
  const google = session.provider === 'google';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          data-slot="account-chip"
          className="shrink-0 gap-1.5 px-1.5 coarse:h-10"
          aria-label={`Signed in as ${who}${ending ? `, session ends in ${minutesLeft(left)} min` : ''}`}
          title={ending ? `Session ends in ${minutesLeft(left)} min` : `Signed in as ${who}`}
        >
          <Face session={session} className="size-5" />
          {label && (
            <span className="max-w-32 truncate text-xs font-normal max-sm:hidden">{label}</span>
          )}
          {ending && (
            <span className="inline-flex items-center gap-1 text-xs font-medium tabular-nums text-state-blocked">
              <span aria-hidden className="size-1.5 rounded-full bg-state-blocked" />
              {minutesLeft(left)}m
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4 p-4">
        <div className="flex items-center gap-3">
          <Face session={session} className="size-8" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium">{who}</p>
            {google && session.email && session.email !== who && (
              <p className="truncate text-xs text-muted-foreground">{session.email}</p>
            )}
            <p className="truncate text-xs text-muted-foreground">
              Tenant <span className="font-mono text-foreground">{session.tenant}</span>
            </p>
          </div>
        </div>

        <p className={cn('text-sm', ending ? 'text-state-blocked' : 'text-muted-foreground')}>
          {left <= 0
            ? 'Your session has ended. The next request will ask you to sign in.'
            : ending
              ? `Your session ends in ${minutesLeft(left)} min, at ${timeOfDay(session.expiresAt)}. Sign in again now so a run is not cut off when it does.`
              : `Signed in until ${timeOfDay(session.expiresAt)}.`}
          {google && left > 0 && ' Signing in again goes to Google and brings you back here.'}
        </p>

        {google ? (
          <GoogleButton redirect={redirectToGoogle} variant={ending ? 'default' : 'outline'} />
        ) : (
          <DeviceLoginBody
            login={login}
            idle={
              <Button
                type="button"
                variant={ending ? 'default' : 'outline'}
                className="w-full coarse:h-10"
                disabled={state.phase === 'starting'}
                onClick={() => void login.start()}
              >
                <RefreshCwIcon
                  className={cn('size-4', state.phase === 'starting' && 'animate-spin')}
                />
                {state.phase === 'starting' ? 'Asking GitHub for a code…' : 'Sign in again'}
              </Button>
            }
          />
        )}

        {!google && <GitHubConnectionRow open={open} />}

        <div className="space-y-1.5 border-t border-border/60 pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-3.5 coarse:h-10"
            onClick={() => {
              cancel();
              setOpen(false);
              // Let go of what this session holds on the harness while it can still ask, forget
              // it and everything kept for it here, and load the app afresh (`lib/leave.ts`).
              void leave({ github: !google });
            }}
          >
            Sign out
          </Button>
          <p className="text-xs text-muted-foreground">
            Signing out forgets the token, this browser’s copies of your threads, and its push
            subscription{google ? '' : ', and the GitHub connection Felix holds'}. Your Felix
            sign-in itself is still honoured until {timeOfDay(session.expiresAt)}.
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Whether Felix holds a GitHub connection for you — the token it keeps to act as you on a
 * repository you open — with the one action on it: revoke. Asked when the popover opens, not
 * polled: it changes when you sign in or revoke, both of which happen here.
 */
function GitHubConnectionRow({ open }: { open: boolean }) {
  const [state, setState] = useState<GitHubConnectionState | 'unknown' | 'error'>('unknown');
  const [revokeFailed, setRevokeFailed] = useState(false);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    getGitHubConnection()
      .then((next) => alive && setState(next))
      .catch(() => alive && setState('error'));
    return () => {
      alive = false;
    };
  }, [open]);

  if (state === 'unknown') return null;
  if (state === 'error') {
    // Under the same rule as the row it stands in for, or the popover's sections lose their
    // rhythm only when the check fails.
    return (
      <p className="border-t border-border/60 pt-3 text-xs text-muted-foreground">
        Could not check your GitHub connection.
      </p>
    );
  }
  const { connected, connection } = state;
  return (
    <div data-slot="github-connection" className="space-y-1.5 border-t border-border/60 pt-3">
      <p className="text-sm">
        {connected
          ? 'Connected to GitHub'
          : connection?.status === 'revoked'
            ? 'GitHub connection stopped working'
            : 'Not connected to GitHub'}
      </p>
      <p className="text-xs text-muted-foreground">
        {connected
          ? 'Felix keeps a token to act as you on repositories you open in a thread.'
          : connection?.status === 'revoked'
            ? 'GitHub refused Felix’s stored token. Sign in again to reconnect.'
            : 'Repositories you open in a thread need a GitHub connection; sign in with GitHub to make one.'}
      </p>
      {connected && (
        // The same question the GitHub page asks: it is the same action, and it is not one
        // an undo can reverse — getting the connection back is a fresh GitHub sign-in.
        <ConfirmButton
          variant="outline"
          destructive
          question="Felix forgets this token and GitHub withdraws the App's grant. Opening a repository needs a GitHub sign-in again."
          confirmLabel="Revoke access"
          onConfirm={() => {
            setRevokeFailed(false);
            return removeGitHubConnection()
              .then(() => setState({ connected: false, connection: null }))
              .catch(() => setRevokeFailed(true));
          }}
        >
          Revoke GitHub access
        </ConfirmButton>
      )}
      {revokeFailed && (
        <p role="alert" className="text-xs text-state-failed">
          Could not revoke the connection. Try again.
        </p>
      )}
    </div>
  );
}
