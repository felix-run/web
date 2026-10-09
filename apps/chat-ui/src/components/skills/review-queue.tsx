import type { ReviewQueueItem } from '@felix/client';
import { Button } from '@felix/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@felix/ui/collapsible';
import { Skeleton } from '@felix/ui/skeleton';
import { ChevronRightIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ReadFailure } from '@/components/inspector/primitives';
import { GateLine } from './gate-line';
import { useReviewQueue } from './queries';
import { ScoreReadout } from './score-readout';
import { ago, SourceLabel } from './skill-status';
import { VersionDecision } from './version-actions';
import { VersionDiff } from './version-diff';

/**
 * Every draft waiting on a person, across skills, oldest first — the order the
 * harness sends, because the draft that has waited longest is the one to read
 * next.
 *
 * Each row is the decision and its evidence together: what the draft is, who
 * wrote it and why, its scores, and — open on the oldest row, one click on the
 * rest — the gate's verdict and its SKILL.md against the live version it would
 * replace. Publishing from here passes the same gate as anywhere else, and the
 * confirm states the verdict whether or not the row was opened.
 */
export function ReviewQueue({ linkTo }: { linkTo: (name: string, version?: string) => string }) {
  const query = useReviewQueue();
  const items = useMemo(() => (query.data?.pages ?? []).flatMap((p) => p.items), [query.data]);

  if (query.isPending) {
    return <Skeleton className="h-16 w-full rounded-md" aria-label="Loading the review queue" />;
  }
  return (
    <div className="space-y-2">
      {query.error ? (
        <ReadFailure
          error={query.error}
          doing="read the skill review queue"
          lastOkAt={query.data ? query.dataUpdatedAt : null}
          onRetry={() => void query.refetch()}
        />
      ) : null}
      {items.length === 0 && !query.error ? (
        <p role="status" className="text-sm text-muted-foreground">
          Nothing is waiting for review.
        </p>
      ) : (
        <ul aria-label="Drafts waiting for review" className="divide-y divide-border/60">
          {items.map((d, i) => (
            <QueueRow
              key={`${d.name}@${d.version}`}
              draft={d}
              linkTo={linkTo}
              // The draft to read next, with its evidence already open. The rest
              // open on request: each open row asks the gate, and a queue of fifty
              // asking at once is a burst the harness sheds.
              defaultOpen={i === 0}
            />
          ))}
        </ul>
      )}
      {query.hasNextPage && (
        <Button
          size="sm"
          variant="outline"
          className="text-xs"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? 'Loading…' : 'Load older drafts'}
        </Button>
      )}
    </div>
  );
}

function QueueRow({
  draft,
  linkTo,
  defaultOpen,
}: {
  draft: ReviewQueueItem;
  linkTo: (name: string, version?: string) => string;
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <li className="space-y-2 py-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link
          to={linkTo(draft.name, draft.version)}
          className="font-mono text-sm font-medium underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
        >
          {draft.name} <span className="text-muted-foreground">{draft.version}</span>
        </Link>
        <span className="text-xs text-muted-foreground">
          {draft.live_version ? (
            <>
              live is <span className="font-mono text-foreground">{draft.live_version}</span>
            </>
          ) : (
            'nothing live yet'
          )}{' '}
          · waiting {ago(draft.created_at).replace(' ago', '')}
        </span>
        <SourceLabel source={draft.source} author={draft.author} />
      </div>
      {draft.reason && (
        <p className="text-sm whitespace-pre-wrap break-words">
          <span className="text-muted-foreground">Reason: </span>
          {draft.reason}
        </p>
      )}
      <ScoreReadout quality={draft.quality_score} security={draft.security_status} />
      <Collapsible open={open} onOpenChange={setOpen}>
        <CollapsibleTrigger className="group inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <ChevronRightIcon
            aria-hidden
            className="size-3.5 transition-transform group-data-[state=open]:rotate-90"
          />
          {draft.live_version
            ? `Gate verdict and diff against live ${draft.live_version}`
            : 'Gate verdict and SKILL.md'}
        </CollapsibleTrigger>
        <CollapsibleContent className="space-y-2 pt-2">
          {open && (
            <>
              <GateLine name={draft.name} version={draft.version} />
              <VersionDiff name={draft.name} before={draft.live_version} after={draft.version} />
            </>
          )}
        </CollapsibleContent>
      </Collapsible>
      <VersionDecision
        name={draft.name}
        version={draft.version}
        liveVersion={draft.live_version}
        parentVersion={draft.parent_version}
      />
    </li>
  );
}
