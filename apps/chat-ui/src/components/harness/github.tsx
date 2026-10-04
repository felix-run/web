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
 */

import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { ExternalLinkIcon, GithubIcon, LockIcon } from 'lucide-react';
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import {
  type GitHubConnectionState,
  type GitHubRepos,
  getGitHubConnection,
  listMyRepos,
  RepoRouteError,
  removeGitHubConnection,
} from '@/api';
import { PageHeader, Panel, PanelBody } from '@/components/harness/panel';
import { getSession, subscribeCredentials } from '@/lib/auth';

export function GitHubPage({ docs }: { docs: string }) {
  const session = useSyncExternalStore(subscribeCredentials, getSession);
  const [connection, setConnection] = useState<GitHubConnectionState | null>(null);
  const [repos, setRepos] = useState<GitHubRepos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [revoking, setRevoking] = useState(false);

  const signedIn = Boolean(session?.login);

  useEffect(() => {
    if (!signedIn) return;
    let alive = true;
    getGitHubConnection()
      .then((state) => {
        if (!alive) return;
        setConnection(state);
        if (state.connected) return listMyRepos().then((r) => alive && setRepos(r));
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof RepoRouteError ? err.message : 'Could not reach the server.');
      });
    return () => {
      alive = false;
    };
  }, [signedIn]);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const list = repos?.repositories ?? [];
    return needle ? list.filter((r) => r.full_name.toLowerCase().includes(needle)) : list;
  }, [repos, filter]);

  const value = !signedIn
    ? 'shared access key'
    : connection === null
      ? undefined
      : connection.connected
        ? `connected as ${session?.login}`
        : connection.connection?.status === 'revoked'
          ? 'connection stopped working'
          : 'not connected';

  return (
    <Panel>
      <PageHeader
        icon={<GithubIcon />}
        title="GitHub"
        headingId="github-page-heading"
        docs={docs}
        value={value}
        valueTone={connection?.connection?.status === 'revoked' ? 'attention' : 'default'}
      />
      <PanelBody>
        <div className="space-y-6">
          {!signedIn && (
            <p className="text-sm text-muted-foreground">
              This browser is signed in with the shared access key, which names no one. Your GitHub
              connection and repositories need a GitHub sign-in.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-state-failed">
              {error}
            </p>
          )}

          {signedIn && connection && (
            <section aria-labelledby="github-connection-heading" className="space-y-2">
              <h2 id="github-connection-heading" className="text-sm font-medium">
                Connection
              </h2>
              {connection.connected ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    Felix keeps a token to act as you on repositories you open in a thread: cloning
                    them, and publishing commits to them with your approval.
                  </p>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={revoking}
                    onClick={() => {
                      setRevoking(true);
                      removeGitHubConnection()
                        .then(() => {
                          setConnection({ connected: false, connection: null });
                          setRepos(null);
                        })
                        .catch(() => setError('Could not revoke the connection. Try again.'))
                        .finally(() => setRevoking(false));
                    }}
                  >
                    Revoke GitHub access
                  </Button>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  {connection.connection?.status === 'revoked'
                    ? 'GitHub refused the token Felix kept. Sign out and sign in with GitHub again to reconnect.'
                    : 'Felix holds no GitHub connection for you. Sign out and sign in with GitHub to make one.'}
                </p>
              )}
            </section>
          )}

          {repos && (
            <section aria-labelledby="github-repos-heading" className="space-y-2">
              <h2 id="github-repos-heading" className="text-sm font-medium">
                Repositories
              </h2>
              <p className="text-sm text-muted-foreground">
                {repos.installations.length === 0
                  ? 'The GitHub App is not installed anywhere you can see.'
                  : `Installed on ${repos.installations.map((i) => i.account).join(', ')}, reaching ${repos.repositories.length} repositor${repos.repositories.length === 1 ? 'y' : 'ies'} for you${repos.truncated ? ' (more exist: filter by name)' : ''}.`}
              </p>
              {repos.repositories.length > 6 && (
                <Input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter repositories"
                  aria-label="Filter repositories"
                  className="h-8 max-w-sm text-sm"
                />
              )}
              {shown.length > 0 && (
                <ul className="divide-y divide-border/60 text-sm" aria-label="Repositories">
                  {shown.map((repo) => (
                    <li key={repo.full_name} className="flex min-w-0 items-center gap-2 py-1.5">
                      {repo.private && (
                        <LockIcon
                          aria-label="private"
                          className="size-3.5 shrink-0 text-muted-foreground"
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate font-mono">{repo.full_name}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {repo.archived ? 'archived' : repo.can_write ? 'read & write' : 'read-only'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {repos.install_url && (
                <a
                  href={repos.install_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                >
                  Install the App on more repositories
                  <ExternalLinkIcon aria-hidden className="size-3.5" />
                </a>
              )}
            </section>
          )}
        </div>
      </PanelBody>
    </Panel>
  );
}
