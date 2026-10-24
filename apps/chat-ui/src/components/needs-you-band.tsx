import { relativeTime } from '@felix/client';
import { SidebarMenuButton, SidebarMenuItem } from '@felix/ui/sidebar';
import { InboxIcon } from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useId, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { listJobs } from '@/api';
import { CutId } from '@/components/cut-id';
import { useSharedPoll } from '@/hooks/useSharedPoll';
import { JOBS_POLL_KEY } from '@/lib/harness-glances';
import { NEEDS_YOU_VISIBLE, needsYouRows, rowKey } from '@/lib/needs-you';
import { whenMounted } from '@/lib/shortcuts';
import { cn } from '@/lib/utils';
import { useShellPick } from '@/shell-context';

/** Characters of an id a band row draws, as the thread list's rows do. */
const ID_CHARS = 30;

/**
 * The band's rows and whether its list of approvals can be spoken as current.
 *
 * Reads only what the shell already polls — the tenant's `/approvals`, this
 * tab's engines — and the Jobs glance's shared read, on its key, so the Jobs page
 * and the harness-view glance ride the same request.
 */
export function useNeedsYou(enabled = true) {
  const { threads, tenantApprovals, blockedThreads, askingThreads, runningThreads } = useShellPick(
    'threads',
    'tenantApprovals',
    'blockedThreads',
    'askingThreads',
    'runningThreads',
  );
  const jobs = useSharedPoll(JOBS_POLL_KEY, listJobs, { enabled, intervalMs: 30_000 });
  const rows = useMemo(
    () =>
      needsYouRows({
        threads,
        approvals: tenantApprovals.pending,
        blocked: blockedThreads,
        asking: askingThreads ?? new Set(),
        running: runningThreads,
        jobs: jobs.data,
      }),
    [threads, tenantApprovals.pending, blockedThreads, askingThreads, runningThreads, jobs.data],
  );
  // The attention line's rule: a list nobody refreshed is no answer, so it may
  // never read as "none". A 403 is an answer — this account may see no approvals.
  const { error, lastOkAt, forbidden } = tenantApprovals;
  const stale = !forbidden && error != null;
  const unchecked = !forbidden && !stale && lastOkAt === null;
  return { rows, stale, unchecked, lastOkAt };
}

/**
 * The sidebar's **Needs you** band: what is live or ran unattended and asks
 * something of the operator, above the thread list (`needsYouRows` says what and
 * in what order).
 *
 * It answers "what needs me" before anything is scrolled, which the list's state
 * groups, the Activity glance and the Jobs glance each answered a third of. At
 * most three rows, and *N more* opens the rest in place; clear, it is its heading
 * alone, saying *none* — never removed, so what is below it does not move when
 * the last thing is answered. It never says *none* over an `/approvals` list it
 * could not refresh: it keeps the last rows and says how old they are.
 *
 * One Tab stop, arrows within, like the thread list beneath it.
 */
export function NeedsYouBand({ onNavigate }: { onNavigate: () => void }) {
  const { rows, stale, unchecked, lastOkAt } = useNeedsYou();
  const { threadId, selectThread } = useShellPick('threadId', 'selectThread');
  const navigate = useNavigate();
  const headingId = useId();
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const shown = expanded ? rows : rows.slice(0, NEEDS_YOU_VISIBLE);
  const hidden = rows.length - shown.length;
  const keys = shown.map(rowKey);
  const tabStop = active && keys.includes(active) ? active : keys[0];

  const status = stale
    ? rows.length > 0
      ? `as of ${lastOkAt != null ? relativeTime(lastOkAt) : 'an earlier check'}`
      : 'not refreshed'
    : unchecked
      ? 'checking'
      : rows.length === 0
        ? 'none'
        : null;

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    const all = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>('[data-needs-you-row]') ?? [],
    );
    const at = all.indexOf(e.currentTarget);
    const to =
      e.key === 'ArrowDown'
        ? at + 1
        : e.key === 'ArrowUp'
          ? at - 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? all.length - 1
              : null;
    if (to === null) return;
    e.preventDefault();
    all[Math.max(0, Math.min(all.length - 1, to))]?.focus();
  }

  /** The approvals no thread owns are decided where the attention line queues them. */
  function reviewUnthreaded() {
    const review = document.querySelector<HTMLElement>('[data-shortcut="review-approvals"]');
    const queued = '[data-approval-focus="queue"]';
    const inQueue = document.querySelector<HTMLElement>(queued);
    if (inQueue) inQueue.focus();
    else if (review) {
      review.click();
      whenMounted(queued, (el) => el.focus());
    }
    onNavigate();
  }

  return (
    <section aria-labelledby={headingId} data-slot="needs-you" className="shrink-0 px-2 pt-3">
      <div className="flex h-7 items-center gap-2 px-2.5">
        <h2 id={headingId} className="text-xs font-semibold text-foreground">
          Needs you
        </h2>
        {status && (
          <span
            data-slot="needs-you-status"
            className={cn(
              'ml-auto truncate text-xs',
              stale && rows.length === 0 ? 'text-state-failed' : 'text-muted-foreground',
            )}
            title={
              stale
                ? "The latest check of the harness's approvals failed, so this list may be out of date."
                : undefined
            }
          >
            {status}
          </span>
        )}
      </div>
      {shown.length > 0 && (
        <ul ref={listRef} aria-labelledby={headingId} className="space-y-0.5 pt-0.5">
          {shown.map((row) => {
            const key = rowKey(row);
            const common = {
              'data-needs-you-row': key,
              tabIndex: key === tabStop ? 0 : -1,
              onFocus: () => setActive(key),
              onKeyDown,
              className: cn(
                'block w-full min-w-0 rounded-lg px-2.5 py-1.5 text-left text-sm outline-none',
                'hover:bg-[color-mix(in_oklab,var(--sidebar-accent)_70%,var(--ground))]',
                'focus-visible:ring-[3px] focus-visible:ring-ring',
              ),
            };
            return (
              <li key={key}>
                {row.kind === 'job' ? (
                  <Link
                    {...common}
                    to={{
                      pathname: '/harness/jobs',
                      search: `?job=${encodeURIComponent(row.name)}`,
                    }}
                    onClick={onNavigate}
                  >
                    <RowBody
                      title={<span className="font-mono">{row.name}</span>}
                      state={<Mark tone="failed">Failing</Mark>}
                      detail={
                        row.lastRunAt != null
                          ? `ran ${relativeTime(row.lastRunAt)}`
                          : 'scheduled job'
                      }
                    />
                  </Link>
                ) : row.kind === 'unthreaded' ? (
                  <button type="button" {...common} onClick={reviewUnthreaded}>
                    <RowBody
                      title={
                        row.tool ? (
                          <span className="font-mono">{row.tool}</span>
                        ) : (
                          `${row.count} approvals`
                        )
                      }
                      state={<Mark tone="blocked">Waiting on you</Mark>}
                      detail="no thread"
                    />
                  </button>
                ) : (
                  <button
                    type="button"
                    {...common}
                    aria-current={row.threadId === threadId ? 'true' : undefined}
                    onClick={() => {
                      if (row.threadId === threadId) navigate(`/t/${row.threadId}`);
                      else selectThread(row.threadId);
                      onNavigate();
                    }}
                  >
                    <RowBody
                      title={
                        row.label.isId ? (
                          <span className="font-mono text-muted-foreground">
                            <CutId id={row.label.text} max={ID_CHARS} />
                          </span>
                        ) : (
                          row.label.text
                        )
                      }
                      state={
                        row.kind === 'waiting' ? (
                          <Mark tone="blocked">Waiting on you</Mark>
                        ) : (
                          <Mark tone="running">Running</Mark>
                        )
                      }
                      detail={
                        row.kind === 'waiting' ? (
                          row.detailIsTool ? (
                            <span className="font-mono">{row.detail}</span>
                          ) : (
                            row.detail
                          )
                        ) : row.agent ? (
                          <span className="font-mono">{row.agent}</span>
                        ) : null
                      }
                    />
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {(hidden > 0 || (expanded && rows.length > NEEDS_YOU_VISIBLE)) && (
        <button
          type="button"
          data-slot="needs-you-more"
          aria-expanded={expanded}
          onClick={() => setExpanded((x) => !x)}
          className="ml-2.5 flex h-7 items-center rounded-md px-0 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
        >
          {expanded ? 'Show fewer' : `${hidden} more`}
        </button>
      )}
    </section>
  );
}

/** A band row: what it is, over its state word and what that state is about. */
function RowBody({
  title,
  state,
  detail,
}: {
  title: ReactNode;
  state: ReactNode;
  detail: ReactNode;
}) {
  return (
    <>
      <span className="block truncate font-medium">{title}</span>
      <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        {state}
        {detail != null && <span className="min-w-0 truncate">{detail}</span>}
      </span>
    </>
  );
}

/** A state word with its dot. Never the dot alone. */
function Mark({ tone, children }: { tone: 'blocked' | 'running' | 'failed'; children: ReactNode }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center gap-1',
        tone === 'blocked'
          ? 'text-state-blocked'
          : tone === 'running'
            ? 'text-state-running'
            : 'text-state-failed',
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children} ·
    </span>
  );
}

/**
 * The band, collapsed to the icon column: one icon that carries the most
 * urgent kind's dot and says what is there, and opens the sidebar onto the band.
 * Always drawn, so the column does not shift when something starts waiting.
 */
export function NeedsYouIcon({ onOpen }: { onOpen: () => void }) {
  const { rows, stale, unchecked, lastOkAt } = useNeedsYou();
  const waiting = rows.filter((r) => r.kind === 'waiting' || r.kind === 'unthreaded').length;
  const jobs = rows.filter((r) => r.kind === 'job').length;
  const running = rows.filter((r) => r.kind === 'running').length;
  // The band's own rule, kept when it is folded to an icon: an empty list that
  // nobody refreshed is no answer, so it is never said as "nothing" — it read as
  // the all-clear here while the expanded band said *not refreshed*.
  const tone =
    waiting > 0
      ? 'bg-state-blocked'
      : jobs > 0
        ? 'bg-state-failed'
        : running > 0
          ? 'bg-state-running'
          : stale
            ? 'bg-state-failed'
            : unchecked
              ? 'bg-muted-foreground'
              : null;
  const counts = [
    waiting > 0 && `${waiting} waiting on you`,
    jobs > 0 && `${jobs} ${jobs === 1 ? 'job' : 'jobs'} failing`,
    running > 0 && `${running} running`,
  ].filter(Boolean);
  const said =
    counts.length > 0
      ? `${counts.join(', ')}${stale ? `, as of ${lastOkAt != null ? relativeTime(lastOkAt) : 'an earlier check'}` : ''}`
      : stale
        ? 'not refreshed'
        : unchecked
          ? 'checking'
          : 'nothing';
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        tooltip={`Needs you: ${said}`}
        onClick={() => {
          onOpen();
          whenMounted('[data-needs-you-row]', (el) => el.focus());
        }}
        className="relative"
      >
        <InboxIcon aria-hidden />
        <span>Needs you</span>
        {tone && (
          <span
            aria-hidden
            className={cn('absolute top-1.5 right-1.5 size-1.5 rounded-full', tone)}
          />
        )}
        <span className="sr-only">, {said}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}
