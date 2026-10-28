import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@felix/ui/popover';
import { GitPullRequestIcon, Loader2Icon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getRepoItem, listRepoItems, type RepoItemDetail, type RepoItems } from '@/api';
import { refusalText } from '@/components/workspace/thread-repo';
import { useShellPick } from '@/shell-context';

/** How long the filter waits after a keystroke before asking GitHub again. */
const FILTER_DEBOUNCE_MS = 250;

/**
 * "Start from an issue or PR", beside the starter prompts while the thread's repository
 * is open: one of its issues or pull requests, put in the composer — title, link and
 * description — for the operator to add their ask to and send.
 *
 * Unlike a starter, it **never sends**. A starter is a prompt this app wrote; an issue's
 * description is whoever opened it, and it is put where the operator reads it before
 * anything reaches the model (`draftMessage`, the kept-message path).
 */
export function StartFromItem({ repo }: { repo: string }) {
  const { draftMessage, streaming } = useShellPick('draftMessage', 'streaming');
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [listing, setListing] = useState<RepoItems | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [taking, setTaking] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Asked on opening, then again as the filter settles; a late answer for an older
  // filter is dropped rather than drawn over the newer one.
  useEffect(() => {
    if (!open) return;
    let live = true;
    const id = window.setTimeout(
      () => {
        listRepoItems(repo, filter.trim()).then(
          (next) => {
            if (!live) return;
            setListing(next);
            setError(null);
          },
          (err: unknown) => live && setError(refusalText(err)),
        );
      },
      listing ? FILTER_DEBOUNCE_MS : 0,
    );
    return () => {
      live = false;
      window.clearTimeout(id);
    };
    // `listing` decides only the first read's delay; it must not re-ask on every answer.
  }, [open, filter, repo]);

  const take = async (number: number) => {
    setTaking(number);
    setError(null);
    try {
      draftMessage(itemMessage(repo, await getRepoItem(repo, number)));
      setOpen(false);
    } catch (err) {
      setError(refusalText(err));
    } finally {
      setTaking(null);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          disabled={streaming}
          className="h-auto w-full flex-col items-start justify-start gap-0.5 whitespace-normal rounded-xl border-border/60 bg-solid-card/40 px-4 py-3 text-left shadow-none hover:bg-solid-accent/60"
        >
          <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
            <GitPullRequestIcon aria-hidden className="size-3.5 text-muted-foreground" />
            Start from an issue or PR
          </span>
          <span className="text-xs font-normal text-muted-foreground">
            One from <span className="font-mono">{repo}</span>, put in the message box to add to —
            nothing is sent.
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[min(28rem,calc(100vw-2rem))] space-y-2 p-3"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          inputRef.current?.focus();
        }}
      >
        <Input
          ref={inputRef}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by title"
          aria-label="Filter issues and pull requests by title"
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
            {/* Said before the list, so an empty or short one is not read as "no issues here". */}
            {pullsOnly(listing) && (
              <p className="text-xs text-muted-foreground">{pullsOnly(listing)}</p>
            )}
            {listing.items.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {pullsOnly(listing)
                  ? filter.trim()
                    ? 'No open pull request has that in its title.'
                    : 'No open pull requests.'
                  : filter.trim()
                    ? 'No open issue or pull request has that in its title.'
                    : 'No open issues or pull requests.'}
              </p>
            ) : (
              <ul
                className="max-h-72 space-y-0.5 overflow-y-auto"
                aria-label="Issues and pull requests"
              >
                {listing.items.map((item) => (
                  <li key={item.number}>
                    <button
                      type="button"
                      disabled={taking !== null}
                      onClick={() => void take(item.number)}
                      className="flex w-full min-w-0 items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none disabled:opacity-60"
                    >
                      <span className="shrink-0 font-mono text-muted-foreground tabular-nums">
                        #{item.number}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{item.title}</span>
                      <span className="shrink-0 text-muted-foreground">
                        {item.kind === 'pull' ? 'PR' : 'issue'}
                      </span>
                      {taking === item.number && (
                        <Loader2Icon aria-hidden className="size-3 shrink-0 animate-spin" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {listing.truncated && (
              <p className="text-xs text-muted-foreground">
                Showing the 30 most recently updated — filter by title for others.
              </p>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Why the list holds pull requests only, or null when issues were listed too. */
export function pullsOnly(listing: RepoItems): string | null {
  switch (listing.issue_access) {
    case 'disabled':
      return 'Pull requests only: issues are turned off for this repository.';
    case 'forbidden':
      return "Pull requests only: the GitHub App can't read this repository's issues.";
    default:
      return null;
  }
}

/**
 * What goes in the composer: which item it is, its link, and its description as written.
 * No instruction is added — the operator says what to do with it — and a description the
 * harness cut says so, so the model is not left reading half of one as the whole.
 */
export function itemMessage(repo: string, item: RepoItemDetail): string {
  const kind = item.kind === 'pull' ? 'Pull request' : 'Issue';
  const head = `${kind} ${repo}#${item.number}: ${item.title}\n${item.html_url}`;
  const body = item.body.trim();
  const cut = item.body_truncated ? '\n\n(The description was cut at 20,000 characters.)' : '';
  return body ? `${head}\n\n${body}${cut}\n\n` : `${head}\n\n`;
}
