/**
 * `/harness/github`: your GitHub connection, and what it reaches.
 *
 * A record, not a workbench: opening a repository happens on a thread (the workspace section's
 * "Repository on the harness"), because a checkout belongs to one thread. What lives here is the
 * standing state behind that — whether Felix holds a GitHub connection for you, the App's
 * installations you can see, the repositories they reach, and the one thing to change: revoke.
 *
 * The App's user token sees only repositories the App is installed on, so a repository missing
 * here is one the App was never given — which the install link is for. The page cannot say how
 * many repositories you could reach without the App; nothing it can ask knows.
 *
 * A truncated listing is the harness saying it stopped walking, so filtering the rows it did send
 * cannot find the rest: past that point the filter asks the harness (`?q=`) instead.
 */

import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { Skeleton } from '@felix/ui/skeleton';
import { ExternalLinkIcon, GithubIcon } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  type GitHubConnectionState,
  type GitHubRepo,
  type GitHubRepos,
  getGitHubConnection,
  listMyRepos,
  removeGitHubConnection,
} from '@/api';
import { ConfirmButton } from '@/components/confirm-button';
import { ErrorNotice } from '@/components/error-notice';
import { PageHeader, PageSection, Panel, PanelBody, plural } from '@/components/harness/panel';
import { getSession, subscribeCredentials } from '@/lib/auth';

/** How long typing pauses before a truncated listing's filter asks the harness. */
const SEARCH_DEBOUNCE_MS = 300;

/** Below this many rows the list is read whole, and a filter would only be in the way. */
const FILTER_FROM = 7;

export function GitHubPage({ docs }: { docs: string }) {
  const session = useSyncExternalStore(subscribeCredentials, getSession);
  const [connection, setConnection] = useState<GitHubConnectionState | null>(null);
  const [repos, setRepos] = useState<GitHubRepos | null>(null);
  const [loadError, setLoadError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const [revokeError, setRevokeError] = useState<unknown>(null);

  const signedIn = Boolean(session?.login);

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    // `attempt` is read so Try again re-runs this; nothing else changes between tries.
    void attempt;
    getGitHubConnection()
      .then((state) => {
        if (!alive) return;
        setConnection(state);
        if (state.connected) return listMyRepos().then((r) => alive && setRepos(r));
      })
      .catch((err) => alive && setLoadError(err));
    return () => {
      alive = false;
    };
  }, [signedIn, attempt]);

  const retry = () => {
    setLoadError(null);
    setAttempt((n) => n + 1);
  };

  const revoke = () => {
    setRevokeError(null);
    return removeGitHubConnection()
      .then(() => {
        setConnection({ connected: false, connection: null });
        setRepos(null);
      })
      .catch(setRevokeError);
  };

  const revoked = connection?.connection?.status === 'revoked';
  // The connection's own login, not the sign-in's: it is the account the token acts as.
  const login = connection?.connection?.github_login ?? session?.login;
  const value = !signedIn
    ? 'shared access key'
    : connection === null
      ? undefined
      : connection.connected
        ? `connected as ${login}`
        : revoked
          ? 'connection stopped working'
          : 'not connected';

  const reading =
    signedIn && !loadError && (connection === null || (connection.connected && !repos));

  return (
    <Panel>
      <PageHeader
        icon={<GithubIcon />}
        title="GitHub"
        headingId="github-page-heading"
        docs={docs}
        value={value}
        valueTone={revoked ? 'attention' : 'default'}
      />
      <PanelBody>
        <p className="sr-only" role="status" aria-live="polite">
          {reading ? 'Loading' : ''}
        </p>
        {!signedIn && (
          <p className="max-w-prose text-sm text-muted-foreground">
            This browser is signed in with the shared access key, which names no one. Your GitHub
            connection and repositories need a GitHub sign-in.
          </p>
        )}
        {loadError ? (
          <ErrorNotice
            error={loadError}
            doing={connection ? 'list your repositories' : 'read your GitHub connection'}
            className="mb-5"
            action={
              <Button
                size="sm"
                variant="outline"
                className="h-7 self-start text-xs"
                onClick={retry}
              >
                Try again
              </Button>
            }
          />
        ) : null}

        {signedIn && connection === null && !loadError && <RowsSkeleton rows={2} />}

        {signedIn && connection && (
          <PageSection title="Connection">
            {connection.connected ? (
              <div className="space-y-3">
                <p className="max-w-prose text-sm text-muted-foreground">
                  Felix keeps a token to act as you on repositories you open in a thread: cloning
                  them, and publishing commits to them with your approval.
                </p>
                <ConfirmButton
                  variant="outline"
                  destructive
                  question="Felix forgets this token and GitHub withdraws the App's grant. Opening a repository needs a GitHub sign-in again."
                  confirmLabel="Revoke access"
                  onConfirm={revoke}
                >
                  Revoke GitHub access
                </ConfirmButton>
                {revokeError ? (
                  <ErrorNotice error={revokeError} doing="revoke the connection" />
                ) : null}
              </div>
            ) : (
              <p className="max-w-prose text-sm text-muted-foreground">
                {revoked
                  ? 'GitHub refused the token Felix kept. Sign out and sign in with GitHub again to reconnect.'
                  : 'Felix holds no GitHub connection for you. Sign out and sign in with GitHub to make one.'}
              </p>
            )}
          </PageSection>
        )}

        {connection?.connected && !repos && !loadError && (
          <PageSection title="Repositories">
            <RowsSkeleton rows={4} />
          </PageSection>
        )}
        {connection?.connected && repos && <Repositories repos={repos} />}
      </PanelBody>
    </Panel>
  );
}

function Repositories({ repos }: { repos: GitHubRepos }) {
  const [filter, setFilter] = useState('');
  const [found, setFound] = useState<{ q: string; repos: GitHubRepos } | null>(null);
  const [searchError, setSearchError] = useState<unknown>(null);

  const needle = filter.trim();
  const remote = repos.truncated && needle !== '';

  useEffect(() => {
    if (!remote) return;
    let alive = true;
    const timer = setTimeout(() => {
      listMyRepos(needle)
        .then((next) => alive && setFound({ q: needle, repos: next }))
        .catch((err) => alive && setSearchError(err));
    }, SEARCH_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [remote, needle]);

  const shown = useMemo<GitHubRepo[] | null>(() => {
    if (remote) return found?.q === needle ? found.repos.repositories : null;
    const lower = needle.toLowerCase();
    return lower
      ? repos.repositories.filter((r) => r.full_name.toLowerCase().includes(lower))
      : repos.repositories;
  }, [remote, found, needle, repos]);

  const count = repos.repositories.length;
  const searching = remote && shown === null && !searchError;

  return (
    <PageSection
      title="Repositories"
      meta={plural(count, 'repository', 'repositories', repos.truncated ? count : undefined)}
    >
      <div className="space-y-3">
        <p className="max-w-prose text-sm text-muted-foreground">
          {repos.installations.length === 0
            ? 'The GitHub App is not installed anywhere you can see.'
            : `The App is installed on ${repos.installations.map((i) => i.account).join(', ')}.${
                repos.truncated
                  ? ` The harness stopped listing after ${count.toLocaleString()}; search by name to reach the rest.`
                  : ''
              }`}
        </p>
        {(count >= FILTER_FROM || repos.truncated) && (
          <Input
            type="search"
            value={filter}
            onChange={(e) => {
              setSearchError(null);
              setFilter(e.target.value);
            }}
            placeholder={repos.truncated ? 'Search repositories by name' : 'Filter repositories'}
            aria-label={repos.truncated ? 'Search repositories by name' : 'Filter repositories'}
            className="h-8 max-w-sm text-sm"
          />
        )}
        {searchError ? <ErrorNotice error={searchError} doing="search your repositories" /> : null}
        {searching && <RowsSkeleton rows={3} />}
        {shown && shown.length > 0 && (
          <ul className="divide-y divide-border/60 text-sm" aria-label="Repositories">
            {shown.map((repo) => (
              <li key={repo.full_name} className="flex min-w-0 items-baseline gap-3 py-1.5">
                <span className="min-w-0 flex-1 truncate font-mono" title={repo.full_name}>
                  {repo.full_name}
                </span>
                <span className="shrink-0 text-xs text-muted-foreground">{access(repo)}</span>
              </li>
            ))}
          </ul>
        )}
        {shown && shown.length === 0 && needle && (
          <p className="text-sm text-muted-foreground">
            No repository the App reaches matches <span className="font-mono">{needle}</span>.
          </p>
        )}
        {repos.install_url && (
          <a
            href={repos.install_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground underline underline-offset-4 decoration-border hover:text-foreground hover:decoration-current"
          >
            Install the App on more repositories
            <ExternalLinkIcon aria-hidden className="size-3.5" />
          </a>
        )}
      </div>
    </PageSection>
  );
}

/** What you can do with a repository, in words: a lock icon alone said "private" to no one. */
function access(repo: GitHubRepo): string {
  const can = repo.archived ? 'archived' : repo.can_write ? 'read & write' : 'read-only';
  return repo.private ? `private · ${can}` : can;
}

function RowsSkeleton({ rows }: { rows: number }) {
  return (
    <div className="space-y-1.5" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-7 w-full rounded-md" />
      ))}
    </div>
  );
}
