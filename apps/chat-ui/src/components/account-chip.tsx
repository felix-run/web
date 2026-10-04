/**
 * Who this browser is signed in as, when it signed in with GitHub. Nothing at
 * all under the shared access key, which names no one.
 *
 * Quiet by design: a face and a login at the end of the header, so the person
 * and the tenant are findable without being a thing the eye keeps landing on.
 * It earns the state colour in one case only — the session is about to end —
 * because the harness keeps no refresh and no revocation, so an ended session
 * is a 401 on the next request and a gate in front of whatever run was live.
 * Renewing happens here, in the popover, with the shell still mounted.
 *
 * Signing out forgets the token in this browser and nothing more. The harness
 * cannot be told to stop honouring it, so the popover says until when it still
 * would, rather than implying that leaving cancelled it.
 */

import { Avatar, AvatarFallback, AvatarImage } from '@felix/ui/avatar';
import { Button } from '@felix/ui/button';
import { cn } from '@felix/ui/lib/utils';
import { Popover, PopoverContent, PopoverTrigger } from '@felix/ui/popover';
import { RefreshCwIcon } from 'lucide-react';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { type GitHubConnectionState, getGitHubConnection, removeGitHubConnection } from '@/api';
import {
  type GitHubSession,
  getSession,
  setSession,
  signOut,
  subscribeCredentials,
} from '@/lib/auth';
import { useDeviceLogin } from '@/lib/github-login';
import { DeviceLoginBody } from './auth/github-sign-in';

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

function Face({ session, className }: { session: GitHubSession; className?: string }) {
  const name = session.login || session.tenant;
  return (
    <Avatar className={className}>
      {session.login && (
        <AvatarImage
          src={`https://github.com/${encodeURIComponent(session.login)}.png?size=64`}
          alt=""
          referrerPolicy="no-referrer"
        />
      )}
      <AvatarFallback className="text-[0.625rem] font-medium uppercase">
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
  const who = session.login ? `@${session.login}` : session.tenant;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          data-slot="account-chip"
          className="shrink-0 gap-1.5 px-1.5"
          aria-label={`Signed in as ${who}${ending ? `, session ends in ${minutesLeft(left)} min` : ''}`}
          title={ending ? `Session ends in ${minutesLeft(left)} min` : `Signed in as ${who}`}
        >
          <Face session={session} className="size-5" />
          {session.login && (
            <span className="max-w-32 truncate text-xs font-normal max-sm:hidden">
              {session.login}
            </span>
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
        </p>

        <DeviceLoginBody
          login={login}
          idle={
            <Button
              type="button"
              variant={ending ? 'default' : 'outline'}
              className="w-full"
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

        <GitHubConnectionRow open={open} />

        <div className="space-y-1.5 border-t border-border/60 pt-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="-ml-3"
            onClick={() => {
              cancel();
              setOpen(false);
              // Forget the stored GitHub connection while this session can still ask, then leave.
              // Best effort: leaving must not wait on, or fail with, a harness that is not there.
              void removeGitHubConnection()
                .catch(() => undefined)
                .finally(signOut);
            }}
          >
            Sign out
          </Button>
          <p className="text-xs text-muted-foreground">
            Signing out forgets the token in this browser and the GitHub connection Felix holds.
            Your Felix sign-in itself is still honoured until {timeOfDay(session.expiresAt)}.
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
  const [busy, setBusy] = useState(false);

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
    return <p className="text-xs text-muted-foreground">Could not check your GitHub connection.</p>;
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => {
            setBusy(true);
            removeGitHubConnection()
              .then(() => setState({ connected: false, connection: null }))
              .catch(() => setState('error'))
              .finally(() => setBusy(false));
          }}
        >
          Revoke GitHub access
        </Button>
      )}
    </div>
  );
}
