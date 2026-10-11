import type { SkillSummary } from '@felix/client';
import { isSkillLibraryError } from '@felix/client';
import { Button } from '@felix/ui/button';
import { Skeleton } from '@felix/ui/skeleton';
import { TriangleAlertIcon } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router';
import { ViewSwitch } from '@/components/harness/panel';
import { ReadFailure } from '@/components/inspector/primitives';
import { type LibraryFilter, useLibraryPages, usePublishPolicy } from './queries';
import { RefusalNotice } from './refusal';
import { ScoreReadout } from './score-readout';
import { ago, SourceLabel } from './skill-status';

/**
 * How many filtered-out pages the list will walk past on its own, looking for
 * rows. The route filters a page *after* reading it, so "drafts by an agent"
 * can be three empty pages and then a full one; stopping at the first empty
 * page would read as "none" while there are some. Bounded, so a large library
 * filtered to nothing is a button press per few hundred skills rather than a
 * silent walk of all of them.
 */
export const AUTO_FOLLOW_PAGES = 4;
const WANT_ROWS = 20;

const STATUS_OPTIONS = [
  ['in-use', 'In use'],
  ['live', 'Live'],
  ['draft', 'Drafts'],
  ['archived', 'Archived'],
  ['all', 'All'],
] as const;

/**
 * Out of use: nothing live and no draft waiting — what archiving a skill, or rejecting its only
 * drafts, leaves. The default view leaves these out; listed with the rest, each read "nothing
 * live" beside skills in use, and a library of retired tests looked like one of live skills.
 */
export function isOutOfUse(s: SkillSummary): boolean {
  return s.live_version == null && !s.pending_drafts;
}
const SOURCE_OPTIONS = [
  ['any', 'Anyone'],
  ['agent', 'Agent'],
  ['operator', 'Operator'],
  ['import', 'Imported'],
  ['promoted', 'Promoted'],
] as const;

export function LibraryList({
  filter,
  onFilter,
  linkTo,
}: {
  filter: LibraryFilter;
  onFilter: (next: LibraryFilter) => void;
  /** The address of one skill's page, keeping whatever else the URL carries. */
  linkTo: (name: string) => string;
}) {
  const query = useLibraryPages(filter);
  const pages = query.data?.pages ?? [];
  const read = useMemo(() => pages.flatMap((p) => p.items), [pages]);
  const inUse = filter.status === undefined;
  const items = useMemo(() => (inUse ? read.filter((s) => !isOutOfUse(s)) : read), [inUse, read]);
  /** Rows the default view read and left out, so an empty one can say they exist. */
  const setAside = read.length - items.length;
  /** A filter the reader chose, as opposed to the default view. */
  const chosen =
    (filter.status !== undefined && filter.status !== 'all') || filter.source !== undefined;
  // In use filters too, here rather than on the route, so once it has set rows aside it walks
  // past pages that held none — and not before, or every short page would be walked.
  const filtered = chosen || (inUse && setAside > 0);

  // Pages walked without the reader asking, reset whenever the filter changes.
  const walked = useRef(0);
  const filterKey = `${filter.status ?? ''}|${filter.source ?? ''}`;
  useEffect(() => {
    walked.current = 0;
  }, [filterKey]);
  const { hasNextPage, isFetchingNextPage, isFetching, fetchNextPage } = query;
  // `pages.length` is a dependency on purpose: a page that arrives empty changes
  // nothing else this effect reads, and without it the walk stops after one step.
  const pageCount = pages.length;
  useEffect(() => {
    if (pageCount === 0) return;
    if (!filtered || !hasNextPage || isFetching || isFetchingNextPage) return;
    if (items.length >= WANT_ROWS || walked.current >= AUTO_FOLLOW_PAGES) return;
    walked.current += 1;
    void fetchNextPage();
  }, [
    pageCount,
    filtered,
    hasNextPage,
    isFetching,
    isFetchingNextPage,
    items.length,
    fetchNextPage,
  ]);

  /**
   * Known to hold nothing at all — no filter applied, nothing on this page and
   * none after it. Eight filter buttons over an empty library filter nothing, so
   * they wait until there is something to narrow. A filtered empty list keeps
   * them, or the reader could not take the filter off again.
   */
  const libraryEmpty =
    !chosen && !query.isPending && !query.error && read.length === 0 && !hasNextPage;

  return (
    <div className="space-y-3">
      {!libraryEmpty && (
        <div className="flex flex-wrap items-center gap-2">
          <ViewSwitch
            label="Status"
            value={filter.status ?? 'in-use'}
            options={STATUS_OPTIONS}
            onChange={(v) => onFilter({ ...filter, status: v === 'in-use' ? undefined : v })}
          />
          <ViewSwitch
            label="Written by"
            value={filter.source ?? 'any'}
            options={SOURCE_OPTIONS}
            onChange={(v) => onFilter({ ...filter, source: v === 'any' ? undefined : v })}
          />
        </div>
      )}

      {query.error ? (
        // A refusal the library names (no personal library, a missing scope) is said in its own
        // words; anything else is a read that failed and may be retried.
        isSkillLibraryError(query.error) && query.error.status === 403 ? (
          <RefusalNotice error={query.error} doing="list this library" />
        ) : (
          <ReadFailure
            error={query.error}
            doing="list the skill library"
            lastOkAt={query.data ? query.dataUpdatedAt : null}
            onRetry={() => void query.refetch()}
          />
        )
      ) : null}

      {query.isPending ? (
        <div className="space-y-1.5" aria-hidden>
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
      ) : items.length === 0 && !query.error ? (
        // A line, as the queue's and the inbox's empty states are: a tinted box
        // here made the one quiet answer on the page its loudest element.
        <p role="status" className="max-w-[48ch] text-sm text-muted-foreground">
          {hasNextPage ? (
            // Said, because an empty filtered page is not an empty library.
            `No match in the first ${pages.length * 50} skills; there are more to look through.`
          ) : inUse && setAside > 0 && !filter.source ? (
            <>
              No skill is in use.{' '}
              {setAside === 1 ? 'One archived skill is' : `${setAside} archived skills are`} under{' '}
              <button
                type="button"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={() => onFilter({ ...filter, status: 'archived' })}
              >
                Archived
              </button>
              .
            </>
          ) : chosen || (inUse && setAside > 0) ? (
            'No skill in the library matches this filter.'
          ) : (
            <>
              The library is empty. Skills an agent drafts with{' '}
              <code className="font-mono">create_skill</code>, and ones saved here, appear in it.
            </>
          )}
        </p>
      ) : (
        <ul aria-label="Library skills" className="divide-y divide-border/60">
          {items.map((s) => (
            <LibraryRow key={s.name} skill={s} to={linkTo(s.name)} />
          ))}
        </ul>
      )}

      {hasNextPage && (
        <Button
          size="sm"
          variant="outline"
          className="text-xs"
          disabled={isFetchingNextPage}
          onClick={() => {
            walked.current = 0;
            void fetchNextPage();
          }}
        >
          {isFetchingNextPage ? 'Loading…' : 'Load more'}
        </Button>
      )}
    </div>
  );
}

const SHADOWS_UPLOAD =
  "An operator upload has the same name: refs that pin no version get this library skill, refs pinning the upload's version still get the upload.";

function LibraryRow({ skill, to }: { skill: SkillSummary; to: string }) {
  const latest = skill.latest;
  const policy = usePublishPolicy().data;
  return (
    <li className="py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <Link
          to={to}
          className="min-w-0 truncate font-mono text-sm font-medium underline-offset-2 hover:underline focus-visible:rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
        >
          {skill.name}
        </Link>
        <span className="text-xs text-muted-foreground">
          {skill.live_version ? (
            <>
              live <span className="font-mono text-foreground">{skill.live_version}</span>
            </>
          ) : (
            'nothing live'
          )}
        </span>
        {skill.pending_drafts > 0 && (
          <span className="rounded-full bg-state-blocked/15 px-1.5 py-0.5 text-xs font-medium text-state-blocked">
            {skill.pending_drafts} draft{skill.pending_drafts === 1 ? '' : 's'} waiting
          </span>
        )}
        {skill.shadows_operator_upload && (
          <span
            className="inline-flex items-center gap-1 text-xs text-foreground"
            title={SHADOWS_UPLOAD}
          >
            <TriangleAlertIcon aria-hidden className="size-3" />
            shadows an upload
            <span className="sr-only">: {SHADOWS_UPLOAD}</span>
          </span>
        )}
      </div>
      {latest && (
        <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="text-xs text-muted-foreground">
            newest <span className="font-mono text-foreground">{latest.version}</span> ·{' '}
            {ago(latest.created_at)}
          </span>
          <SourceLabel source={latest.source} />
          <ScoreReadout
            quality={latest.quality_score}
            security={latest.security_status}
            policy={policy}
          />
        </div>
      )}
    </li>
  );
}
