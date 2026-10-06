/**
 * This thread's repository: one of your own GitHub repositories, checked out on the harness for
 * this thread alone (`POST /chat/sessions/{t}/workspace/repo`).
 *
 * It is a different workspace from the folder above it. That one is the browser's — client tools
 * running in this tab, against the in-tab files or a folder you mounted. This one is the
 * harness's: its own workspace and shell tools work in the checkout, and nowhere else, for as
 * long as the thread has it, and `publish_commits` (with `auth: person`) publishes to it as you.
 * The heading says "on the harness" so the two are not read as one.
 *
 * Opening a repository needs a GitHub sign-in: every read and the clone act as you, with the
 * connection the harness keeps. Under the shared access key there is no "you", so the block
 * offers nothing rather than a button that can only refuse.
 */

import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@felix/ui/popover';
import { ExternalLinkIcon, GitBranchIcon, Loader2Icon, LockIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  type GitHubRepos,
  getThreadRepo,
  listMyRepos,
  listThreadRepoFiles,
  openThreadRepo,
  RepoRouteError,
  removeThreadRepo,
  type ThreadRepo,
  type ThreadRepoFiles,
} from '@/api';
import { ConfirmButton } from '@/components/confirm-button';
import { RepoFileTree } from '@/components/workspace/repo-files';
import { getSession, subscribeCredentials } from '@/lib/auth';
import { cn } from '@/lib/utils';

/** How often a cloning checkout is asked about. A clone is seconds to a few minutes. */
const CLONING_POLL_MS = 2_000;

/** What each refusal code means to the person, where the harness's own message is not enough. */
function refusalText(err: unknown): string {
  if (err instanceof RepoRouteError) {
    switch (err.code) {
      case 'github_not_connected':
        return 'Felix holds no GitHub connection for you. Sign out and sign in with GitHub again.';
      case 'github_connection_revoked':
        return 'Your GitHub connection stopped working. Sign out and sign in with GitHub again.';
      default:
        return err.message;
    }
  }
  return 'Could not reach the server.';
}

export function ThreadRepoSection({
  threadId,
  streaming = false,
}: {
  threadId: string;
  /** Whether a run is going; its end re-reads the checkout. */
  streaming?: boolean;
}) {
  const session = useSyncExternalStore(subscribeCredentials, getSession);
  const [repo, setRepo] = useState<ThreadRepo | null | undefined>(undefined);
  const [files, setFiles] = useState<ThreadRepoFiles | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const next = await getThreadRepo(threadId);
      setRepo(next);
      // The files only once the clone is done: while cloning the route answers 409.
      setFiles(next?.state === 'ready' ? await listThreadRepoFiles(threadId) : null);
      setError(null);
    } catch (err) {
      setError(refusalText(err));
    }
  }, [threadId]);

  const signedIn = Boolean(session?.login);

  // Only for a GitHub sign-in: under the shared key nothing here can act, and a page load must not
  // ask the harness about a thread before a message has made it one (`tests/session-lease`).
  // Re-read when a run settles, too: the agent's tools and shell change the checkout, and the
  // branch, commits ahead and the files' status are the harness's to report.
  useEffect(() => {
    setRepo(undefined);
    setFiles(null);
    if (signedIn) void refresh();
  }, [refresh, signedIn]);
  const wasStreaming = useRef(streaming);
  useEffect(() => {
    if (wasStreaming.current && !streaming && signedIn) void refresh();
    wasStreaming.current = streaming;
  }, [streaming, signedIn, refresh]);

  // A clone finishes in the background: ask until it says how it went.
  useEffect(() => {
    if (repo?.state !== 'cloning') return;
    const id = window.setTimeout(() => void refresh(), CLONING_POLL_MS);
    return () => window.clearTimeout(id);
  }, [repo, refresh]);

  if (!signedIn) return null;

  return (
    <section aria-labelledby="thread-repo-heading" data-slot="thread-repo">
      <h3 id="thread-repo-heading" className="mb-1.5 text-xs font-semibold text-muted-foreground">
        Repository on the harness
      </h3>
      {error && (
        <p role="alert" className="mb-1.5 text-xs text-state-failed">
          {error}
        </p>
      )}
      {repo === undefined ? null : repo === null ? (
        <RepoPicker
          onOpen={async (fullName) => {
            setError(null);
            try {
              setRepo(await openThreadRepo(threadId, fullName));
            } catch (err) {
              setError(refusalText(err));
            }
          }}
        />
      ) : (
        <RepoStatus
          repo={repo}
          files={files}
          onRemove={async () => {
            try {
              await removeThreadRepo(threadId);
              setRepo(null);
              setFiles(null);
            } catch (err) {
              setError(refusalText(err));
            }
          }}
        />
      )}
    </section>
  );
}

function RepoStatus({
  repo,
  files,
  onRemove,
}: {
  repo: ThreadRepo;
  files: ThreadRepoFiles | null;
  onRemove: () => Promise<void>;
}) {
  const facts =
    repo.state === 'ready'
      ? [
          repo.branch ?? repo.base,
          repo.ahead === null ? null : repo.ahead === 0 ? 'up to date' : `${repo.ahead} ahead`,
          repo.dirty ? 'uncommitted changes' : null,
        ].filter(Boolean)
      : [];
  return (
    <div className="space-y-1.5">
      <p className="flex min-w-0 items-center gap-1.5 text-xs">
        {repo.private && (
          <LockIcon aria-label="private" className="size-3 shrink-0 text-muted-foreground" />
        )}
        <span className="truncate font-mono text-foreground" title={repo.repo}>
          {repo.repo}
        </span>
      </p>
      {repo.state === 'cloning' && (
        <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Loader2Icon aria-hidden className="size-3 animate-spin" />
          Cloning on the harness…
        </p>
      )}
      {repo.state === 'ready' && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <GitBranchIcon aria-hidden className="size-3 shrink-0" />
          <span className="truncate">{facts.join(' · ')}</span>
        </p>
      )}
      {repo.state === 'ready' && files && <RepoFileTree key={repo.repo} listing={files} />}
      {repo.state === 'failed' && (
        <p role="alert" className="text-xs text-state-failed">
          The clone failed: {repo.error ?? 'no reason given'}.
        </p>
      )}
      {repo.state === 'expired' && (
        <p className="text-xs text-muted-foreground">
          Removed after a stretch unused. Remove it here, then open it again to continue.
        </p>
      )}
      {repo.state !== 'cloning' && (
        <ConfirmButton
          size="xs"
          variant="ghost"
          className="-ml-2"
          destructive
          question={
            repo.state === 'ready' && (repo.ahead || repo.dirty)
              ? `Remove ${repo.repo} from this thread? Its unpublished work goes with it.`
              : `Remove ${repo.repo} from this thread?`
          }
          confirmLabel="Remove"
          onConfirm={onRemove}
        >
          Remove from thread
        </ConfirmButton>
      )}
    </div>
  );
}

/**
 * The repositories you can open: where the GitHub App is installed and you have access. The App's
 * user token sees only that intersection, so a repository missing here is one the App is not
 * installed on — which is what the install link at the foot is for.
 */
function RepoPicker({ onOpen }: { onOpen: (fullName: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [listing, setListing] = useState<GitHubRepos | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open || listing) return;
    let alive = true;
    listMyRepos()
      .then((next) => alive && setListing(next))
      .catch((err) => alive && setError(refusalText(err)));
    return () => {
      alive = false;
    };
  }, [open, listing]);

  const shown = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const repos = listing?.repositories ?? [];
    return needle ? repos.filter((r) => r.full_name.toLowerCase().includes(needle)) : repos;
  }, [listing, filter]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 w-full text-xs">
          Open a repository
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 space-y-2 p-3"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <Input
          ref={inputRef}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter repositories"
          aria-label="Filter repositories"
          className="h-8 text-sm"
        />
        {error && (
          <p role="alert" className="text-xs text-state-failed">
            {error}
          </p>
        )}
        {!listing && !error && (
          <p role="status" className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2Icon aria-hidden className="size-3 animate-spin" />
            Asking GitHub…
          </p>
        )}
        {listing && (
          <>
            <p className="text-xs text-muted-foreground">
              {listing.repositories.length === 0
                ? 'The GitHub App is not installed on any repository you can reach.'
                : `${listing.repositories.length} repositor${listing.repositories.length === 1 ? 'y' : 'ies'} the GitHub App can reach for you${listing.truncated ? ' (more exist: filter by name)' : ''}.`}
            </p>
            {shown.length > 0 && (
              <ul className="max-h-64 space-y-0.5 overflow-y-auto" aria-label="Repositories">
                {shown.map((repo) => (
                  <li key={repo.full_name}>
                    <button
                      type="button"
                      disabled={opening !== null}
                      onClick={() => {
                        setOpening(repo.full_name);
                        void onOpen(repo.full_name).finally(() => {
                          setOpening(null);
                          setOpen(false);
                        });
                      }}
                      className={cn(
                        'flex w-full min-w-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60',
                      )}
                    >
                      {repo.private && (
                        <LockIcon
                          aria-label="private"
                          className="size-3 shrink-0 text-muted-foreground"
                        />
                      )}
                      <span className="min-w-0 flex-1 truncate font-mono">{repo.full_name}</span>
                      {repo.archived ? (
                        <span className="shrink-0 text-muted-foreground">archived</span>
                      ) : !repo.can_write ? (
                        <span className="shrink-0 text-muted-foreground">read-only</span>
                      ) : null}
                      {opening === repo.full_name && (
                        <Loader2Icon aria-hidden className="size-3 animate-spin" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {listing.install_url && (
              <a
                href={listing.install_url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                Install the App on more repositories
                <ExternalLinkIcon aria-hidden className="size-3" />
              </a>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
