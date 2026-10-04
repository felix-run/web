import {
  ActivityIcon,
  BookOpenIcon,
  BotIcon,
  BrainIcon,
  ClockIcon,
  FlaskConicalIcon,
  GitBranchIcon,
  GithubIcon,
  type LucideIcon,
  PuzzleIcon,
} from 'lucide-react';
import { Fragment, type KeyboardEvent, lazy, Suspense, useEffect } from 'react';
import { Navigate, NavLink, Outlet, useMatch } from 'react-router';
import { listAudit, listJobs } from '@/api';
import { useHarnessAgent } from '@/components/harness/harness-agent';
import { DOCS_ORIGIN, PageBack, PageDocs } from '@/components/harness/panel';
import { relTime } from '@/components/inspector/primitives';
import { WORKSPACE_INLINE } from '@/hooks/use-rails';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useSharedPoll } from '@/hooks/useSharedPoll';
import {
  ACTIVITY_FETCH,
  AUDIT_POLL_KEY,
  failing,
  JOBS_POLL_KEY,
  LEDGER_GLANCE_SPAN,
  recentFailures,
} from '@/lib/harness-glances';
import { setPresencePlace } from '@/lib/presence';
import { cn } from '@/lib/utils';

/**
 * `/harness`: the route table's half that the sidebar also reads — the eight
 * destinations, their nav and its glances, and the layout route. The pages
 * themselves are `harness-pages.tsx`, loaded on first visit; see there.
 */
const HarnessPage = lazy(() => import('./harness-pages'));

export type HarnessPath =
  | 'memory'
  | 'corpus'
  | 'skills'
  | 'ledger'
  | 'agent'
  | 'github'
  | 'manifests'
  | 'jobs'
  | 'eval';

/**
 * The eight destinations, declared once.
 *
 * The nav and the route table are built from this same list, because a nav entry
 * with no route is a dead link and a route with no nav entry is a page nobody can
 * reach — and both of those are silent.
 *
 * `group` is the split this file's own header describes and the nav used to
 * hide: *records*, read far more often than changed — including Agent, which
 * reads the resolved spec and changes nothing — and *workbenches*, where the
 * operator changes what the next run does. Eight equal rows made the reader sort
 * them on every visit; two labelled runs have already been sorted.
 */
const MANAGEMENT_API = `${DOCS_ORIGIN}/guide/management-api/`;
const MANIFEST_REFERENCE = `${DOCS_ORIGIN}/guide/manifest-reference/`;

/** Where the GitHub page's reference lives: the connection and per-person repositories. */
export const GITHUB_DOCS = `${DOCS_ORIGIN}/internals/auth/#per-person-repositories`;

/** The Ledger's two halves read different routes, documented in different sections. */
export const LEDGER_DOCS = {
  activity: `${MANAGEMENT_API}#audit`,
  usage: `${MANAGEMENT_API}#usage`,
} as const;

export const HARNESS_DESTINATIONS: {
  path: HarnessPath;
  label: string;
  icon: LucideIcon;
  group: 'records' | 'workbenches';
  /** The reference for what this page shows; `tests/docs-links.test.ts` checks it exists. */
  docs: string;
  element: React.ReactNode;
}[] = [
  {
    path: 'memory',
    docs: `${MANAGEMENT_API}#memory`,
    label: 'Memory',
    icon: BrainIcon,
    group: 'records',
    element: <HarnessPage path="memory" />,
  },
  {
    path: 'corpus',
    docs: `${MANAGEMENT_API}#documents`,
    label: 'Corpus',
    icon: BookOpenIcon,
    group: 'records',
    element: <HarnessPage path="corpus" />,
  },
  {
    path: 'skills',
    docs: `${MANAGEMENT_API}#skills`,
    label: 'Skills',
    icon: PuzzleIcon,
    group: 'records',
    element: <HarnessPage path="skills" />,
  },
  {
    path: 'ledger',
    docs: `${MANAGEMENT_API}#audit`,
    label: 'Ledger',
    icon: ActivityIcon,
    group: 'records',
    element: <HarnessPage path="ledger" />,
  },
  // A record, not a workbench: it reads the resolved spec and changes nothing.
  {
    path: 'agent',
    docs: `${MANIFEST_REFERENCE}`,
    label: 'Agent',
    icon: BotIcon,
    group: 'records',
    element: <HarnessPage path="agent" />,
  },
  // A record: your GitHub connection and what it reaches. Opening a repository is a thread's
  // act and happens in the workspace section, not here.
  {
    path: 'github',
    docs: GITHUB_DOCS,
    label: 'GitHub',
    icon: GithubIcon,
    group: 'records',
    element: <HarnessPage path="github" />,
  },
  {
    path: 'manifests',
    docs: `${MANAGEMENT_API}#manifests`,
    label: 'Manifests',
    icon: GitBranchIcon,
    group: 'workbenches',
    element: <HarnessPage path="manifests" />,
  },
  {
    path: 'jobs',
    docs: `${MANAGEMENT_API}#jobs`,
    label: 'Jobs',
    icon: ClockIcon,
    group: 'workbenches',
    element: <HarnessPage path="jobs" />,
  },
  {
    path: 'eval',
    docs: `${MANAGEMENT_API}#eval`,
    label: 'Eval',
    icon: FlaskConicalIcon,
    group: 'workbenches',
    element: <HarnessPage path="eval" />,
  },
];

export const GROUPS = [
  { key: 'records', label: 'Records' },
  { key: 'workbenches', label: 'Workbenches' },
] as const;

/**
 * Up and down move between the nav's links, Home and End to either end.
 *
 * No global destination keys: every free `Mod+<key>` is already spent
 * (`lib/shortcuts.ts` says which and why), and a bare letter would type into
 * Memory's search box. What an operator gets instead is arrows on top of the
 * Tab stops: every link is still one, as links are, and once focus is in the
 * list the arrows move through it faster.
 */
export function walkNav(event: KeyboardEvent<HTMLElement>) {
  const moves: Record<string, (i: number, n: number) => number> = {
    ArrowDown: (i, n) => (i + 1) % n,
    ArrowUp: (i, n) => (i - 1 + n) % n,
    Home: () => 0,
    End: (_i, n) => n - 1,
  };
  const move = moves[event.key];
  if (!move) return;
  const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>('a[href]'));
  const at = links.indexOf(document.activeElement as HTMLAnchorElement);
  if (at === -1) return;
  event.preventDefault();
  links[move(at, links.length)]?.focus();
}

/**
 * The two states on the rail worth a glance: jobs that are failing, and recent
 * failures in the Ledger — from the same reads those pages make. They poll
 * behind two links, which the rail used to avoid on purpose; the trade is that
 * someone coming back sees where to go first without opening eight pages, which
 * is what "legible on return" asks.
 *
 * The Ledger's is bounded by time, where its page's header is bounded by count.
 * The page counts failures in its last `ACTIVITY_FETCH` events, which is right
 * for a page you are reading and wrong for a marker that means "go look": on a
 * quiet tenant sixty events can span weeks, so one failure from last month kept
 * the rail red indefinitely and the marker stopped meaning anything. Jobs need
 * no bound — "failing" is each job's current state, and it clears when a run
 * succeeds.
 */

interface Glance {
  text: string;
  /**
   * How old a kept count is, drawn beside it — `2m` — when the latest read
   * failed. On screen, not only in `title`: a count that cannot vouch for itself
   * looked exactly like a current one.
   */
  age?: string;
  /**
   * The window a count covers, drawn beside it — `24h` — so the rail's number
   * does not read as a contradiction of the page's, which counts a longer one.
   */
  span?: string;
  /** Spoken, and shown on hover: the full reading the short text abbreviates. */
  title: string;
  /** A count of failures, or an honest "could not check". */
  tone: 'failed' | 'unknown';
}

/**
 * One glance from one poll.
 *
 * Absence is this rail's all-clear, so it may only be absent when the read
 * *answered* nothing. A failed read with nothing earlier is a muted `?`, not a
 * blank — the attention line's rule, that it never says the all-clear on a list
 * it could not refresh — and a failed read after a good one keeps the count and
 * says its age.
 */
export function glanceOf(
  poll: { data: unknown[] | undefined; error: unknown; lastOkAt: number | null },
  count: number,
  word: string,
  noun: string,
  span?: string,
): Glance | undefined {
  const within = span ? ` in the last ${span}` : '';
  if (poll.error) {
    const since = poll.lastOkAt != null ? relTime(poll.lastOkAt) : null;
    const ago = since === 'now' ? 'just now' : `${since} ago`;
    // A failed read whose last answer was zero is still a failed read. This
    // returned nothing when the earlier count was 0 — the rail's all-clear, over
    // a list it could not refresh, which is the one thing the docblock forbids.
    if (count === 0 || poll.data === undefined) {
      return {
        // A word, not `?`: its meaning was only in a hover title, which a
        // keyboard, a touch screen or the phone-width list never shows.
        text: 'unchecked',
        title: since
          ? `Couldn't check ${noun}; last answered ${ago} with none${within}`
          : `Couldn't check ${noun}`,
        tone: 'unknown',
      };
    }
    return {
      text: `${count} ${word}`,
      age: since ?? undefined,
      title: `${count} ${word}${within}, as of ${ago} — the latest check failed`,
      tone: 'failed',
    };
  }
  if (count === 0) return undefined;
  return { text: `${count} ${word}`, span, title: `${count} ${word}${within}`, tone: 'failed' };
}

export function useNavGlances(enabled = true): Record<string, Glance | undefined> {
  // Shared reads: on the Jobs page or the Ledger these ride the page's own
  // faster poll rather than sending the same request a second time.
  const jobs = useSharedPoll(JOBS_POLL_KEY, listJobs, { enabled, intervalMs: 30_000 });
  const audit = useSharedPoll(AUDIT_POLL_KEY, () => listAudit({ limit: ACTIVITY_FETCH }), {
    enabled,
    intervalMs: 30_000,
  });
  const failingJobs = (jobs.data ?? []).filter(failing).length;
  // Measured against the clock at render, which the 30s poll re-runs, so a
  // failure ages out within a tick of turning 24 hours old.
  const failedEvents = recentFailures(audit.data ?? [], Date.now());
  return {
    jobs: glanceOf(jobs, failingJobs, 'failing', 'jobs'),
    ledger: glanceOf(audit, failedEvents, 'failed', 'the ledger', LEDGER_GLANCE_SPAN),
  };
}

/** A destination's glance, drawn at the end of its nav row. */
export function NavGlance({ glance }: { glance: Glance | undefined }) {
  if (!glance) return null;
  return (
    <span
      title={glance.title}
      className={cn(
        'ml-auto shrink-0 pl-2 text-xs font-medium tabular-nums',
        glance.tone === 'failed' ? 'text-state-failed' : 'text-muted-foreground',
      )}
    >
      {/* For the accessible name, which would otherwise run "Jobs1 failing"
          together — and carries the age or the "couldn't check" that the short
          text abbreviates. */}
      <span className="sr-only">, {glance.title}</span>
      <span aria-hidden>{glance.text}</span>
      {glance.span && !glance.age && (
        <span aria-hidden className="font-normal text-muted-foreground">
          {' · '}
          {glance.span}
        </span>
      )}
      {glance.age && (
        <span aria-hidden className="font-normal text-muted-foreground">
          {' · '}
          {glance.age}
        </span>
      )}
    </span>
  );
}

function HarnessNav({ onNavigate, className }: { onNavigate?: () => void; className?: string }) {
  const { search } = useHarnessAgent();
  const glance = useNavGlances();
  return (
    // Every link a Tab stop, as links are; the arrow keys are an extra on top.
    // A single roving stop made seven pages undiscoverable to anyone tabbing,
    // with nothing to say the arrows existed — roving focus is a pattern for
    // composite widgets, and a list of links is not one.
    <nav aria-label="Harness" className={cn('p-2', className)} onKeyDown={walkNav}>
      {GROUPS.map(({ key, label }, gi) => (
        <Fragment key={key}>
          {/* Shown, not only announced. The labels were `aria-label`s and the rule
              between the runs was `border/60` — about 6% white in dark — so a
              screen reader heard two groups and everyone else saw eight rows. */}
          {gi > 0 && <hr aria-hidden className="mx-2.5 my-2 border-border" />}
          <p
            id={`harness-nav-${key}`}
            className="px-2.5 pt-1 pb-1 text-xs font-medium text-muted-foreground"
          >
            {label}
          </p>
          <ul aria-labelledby={`harness-nav-${key}`} className="flex flex-col gap-0.5">
            {HARNESS_DESTINATIONS.filter((d) => d.group === key).map(
              ({ path, label: name, icon: Icon }) => (
                <li key={path}>
                  {/* The agent rides along: moving between pages keeps looking at
                      the same one. */}
                  <NavLink
                    to={{ pathname: path, search }}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2 rounded-md px-2.5 py-2 text-sm transition-colors',
                        'focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none',
                        isActive
                          ? 'bg-accent font-medium text-accent-foreground'
                          : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                      )
                    }
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="truncate">{name}</span>
                    <NavGlance glance={glance[path]} />
                  </NavLink>
                </li>
              ),
            )}
          </ul>
        </Fragment>
      ))}
    </nav>
  );
}

function PageLoading() {
  return (
    <p role="status" className="p-4 text-sm text-muted-foreground">
      Loading…
    </p>
  );
}

/**
 * Layout route for `/harness`.
 *
 * From 1024 the app sidebar is inline and carries the destinations itself, so
 * this layout is the page alone. Between 768 and 1024 the sidebar is a drawer,
 * and the nav is a resident rail here instead — the destinations must be one
 * click away at every width, not one drawer away. Narrow, there is no room for
 * both, so `/harness` *is* the list and a destination is a page with a way back —
 * which is also why the index only redirects on a wide viewport. Redirecting on a
 * phone would mean the list could never be seen at all.
 */
export function HarnessLayout() {
  const wide = useMediaQuery('(min-width: 768px)');
  const sidebarInline = useMediaQuery(WORKSPACE_INLINE);
  const atIndex = !!useMatch('/harness');
  const at = useMatch('/harness/:destination')?.params.destination;
  const destination = HARNESS_DESTINATIONS.find((d) => d.path === at);
  const place = destination?.label ?? 'Harness';
  const { search } = useHarnessAgent();

  // The tab strip names the page: eight open destinations all read "Felix chat".
  // Cleared on the way out, so the conversation's tab goes back to naming only
  // the run.
  useEffect(() => {
    setPresencePlace(place);
  }, [place]);
  useEffect(() => () => setPresencePlace(null), []);

  // The Ledger, not the first entry in the list. `/harness` is where an operator
  // comes back to, and the Ledger is the page that answers "what happened while
  // I was away"; Memory — first in the list — is empty for most tenants.
  if (atIndex && wide) return <Navigate to={{ pathname: 'ledger', search }} replace />;

  // Every shape below puts the destination in a `<main>`. The layout had a header
  // and a nav and no main, so a screen reader's landmark list offered every way
  // *around* the page and none into it, and "skip to main content" had nowhere to
  // land. Narrow, the index's list is the page's content, so it is the main there.
  if (!wide && atIndex) {
    return (
      <main className="flex min-h-0 flex-1 flex-col">
        <div className="shrink-0 border-b border-border/60 px-4 py-3">
          {/* `h2`: the shell's wordmark is the page's one `h1`, and every
                destination's own heading is an `h2` beside this one. */}
          <h2 className="text-sm font-semibold">Harness</h2>
          <p className="text-xs text-muted-foreground">What this tenant owns, across every run.</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          <HarnessNav />
        </div>
      </main>
    );
  }

  // One tree for every destination at every width. Narrow and wide used to
  // return different roots, so crossing 768px — rotating a tablet, dragging a
  // window — unmounted the page and remounted it fresh, and an unsaved skill
  // edit, a half-typed search, an open form went with it. The nav is a slot
  // that is empty narrow; the way back is a context that is empty wide; the
  // `<Outlet/>` sits at the same depth either way.
  return (
    <div className="flex min-h-0 flex-1">
      {wide && !sidebarInline && (
        <div className="w-56 shrink-0 overflow-y-auto border-r border-border/60">
          <HarnessNav />
        </div>
      )}
      <main className="flex min-h-0 min-w-0 flex-1 flex-col">
        {/* The way back lives in the destination's own header, in the icon's
            place, rather than in a row of its own above it: see `PageBack`. */}
        <PageBack.Provider
          value={wide ? null : { to: `/harness${search}`, label: 'Back to Harness' }}
        >
          <PageDocs.Provider value={destination?.docs ?? null}>
            {/* The pages load on the first visit; the layout and its nav are
                already here, so only the page's own area waits. */}
            <Suspense fallback={<PageLoading />}>
              <Outlet />
            </Suspense>
          </PageDocs.Provider>
        </PageBack.Provider>
      </main>
    </div>
  );
}
