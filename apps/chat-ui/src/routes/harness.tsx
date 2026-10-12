import { isSkillLibraryError } from '@felix/client';
import { Skeleton } from '@felix/ui/skeleton';
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
import {
  Fragment,
  type KeyboardEvent,
  lazy,
  type RefObject,
  Suspense,
  useEffect,
  useMemo,
  useRef,
} from 'react';
import { Navigate, NavLink, Outlet, useMatch } from 'react-router';
import { listAudit, listJobs, listSkillReviewQueue } from '@/api';
import { useHarnessAgent } from '@/components/harness/harness-agent';
import { DOCS_ORIGIN, PageBack, PageDocs, useMeasure } from '@/components/harness/panel';
import { relTime } from '@/components/inspector/primitives';
import { PaneColumn, PaneOverlay, type PaneZoneProps } from '@/components/pane/pane-zone';
import { usePaneLayout } from '@/components/pane/use-pane-layout';
import { WORKSPACE_INLINE } from '@/hooks/use-rails';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { useSharedPoll } from '@/hooks/useSharedPoll';
import { landedPaths } from '@/lib/changes';
import {
  ACTIVITY_FETCH,
  ACTIVITY_GLANCE_SPAN,
  AUDIT_POLL_KEY,
  failing,
  JOBS_POLL_KEY,
  recentFailures,
  SKILL_QUEUE_GLANCE_LIMIT,
  SKILL_QUEUE_POLL_KEY,
} from '@/lib/harness-glances';
import { setPresencePlace } from '@/lib/presence';
import { usePaneState } from '@/lib/side-pane';
import { cn } from '@/lib/utils';
import { useOptionalShell } from '@/shell-context';

/**
 * `/harness`: the route table's half that the sidebar also reads — the nine
 * destinations, their nav and its glances, and the layout route. The pages
 * themselves are `harness-pages.tsx`, loaded on first visit; see there.
 */
const HarnessPage = lazy(() => import('./harness-pages'));

export type HarnessPath =
  | 'memory'
  | 'documents'
  | 'skills'
  | 'activity'
  | 'agent'
  | 'github'
  | 'manifests'
  | 'jobs'
  | 'eval';

/**
 * The nine destinations, declared once.
 *
 * The nav and the route table are built from this same list, because a nav entry
 * with no route is a dead link and a route with no nav entry is a page nobody can
 * reach — and both of those are silent.
 *
 * `group` is the question a page answers, in the order an operator coming back
 * asks them: what happened (Activity, Jobs), what the agent knows (Memory,
 * Documents, Skills), and how it is set up (Agent, Manifests, Eval, GitHub). It
 * was *records* and *workbenches* — read versus changed — which was how the code
 * was sorted, not a question anyone arrives with, and the first run had grown to
 * six. Runs of four or fewer are read at a glance; Activity leads because
 * `/harness` lands there.
 */
const MANAGEMENT_API = `${DOCS_ORIGIN}/guide/management-api/`;
const MANIFEST_REFERENCE = `${DOCS_ORIGIN}/guide/manifest-reference/`;

/** Where the GitHub page's reference lives: the connection and per-person repositories. */
export const GITHUB_DOCS = `${DOCS_ORIGIN}/internals/auth/#per-person-repositories`;

export const HARNESS_DESTINATIONS: {
  path: HarnessPath;
  label: string;
  icon: LucideIcon;
  group: (typeof GROUPS)[number]['key'];
  /** The reference for what this page shows; `tests/docs-links.test.ts` checks it exists. */
  docs: string;
  element: React.ReactNode;
}[] = [
  {
    path: 'activity',
    // The ledger reads both records; audit is where its events, and the page's
    // link to `/usage/threads`, are explained.
    docs: `${MANAGEMENT_API}#audit`,
    label: 'Activity',
    icon: ActivityIcon,
    group: 'happened',
    element: <HarnessPage path="activity" />,
  },
  {
    path: 'jobs',
    docs: `${MANAGEMENT_API}#jobs`,
    label: 'Jobs',
    icon: ClockIcon,
    group: 'happened',
    element: <HarnessPage path="jobs" />,
  },
  {
    path: 'memory',
    docs: `${MANAGEMENT_API}#memory`,
    label: 'Memory',
    icon: BrainIcon,
    group: 'knows',
    element: <HarnessPage path="memory" />,
  },
  {
    path: 'documents',
    docs: `${MANAGEMENT_API}#documents`,
    label: 'Documents',
    icon: BookOpenIcon,
    group: 'knows',
    element: <HarnessPage path="documents" />,
  },
  {
    path: 'skills',
    docs: `${MANAGEMENT_API}#skills`,
    label: 'Skills',
    icon: PuzzleIcon,
    group: 'knows',
    element: <HarnessPage path="skills" />,
  },
  {
    path: 'agent',
    docs: `${MANIFEST_REFERENCE}`,
    label: 'Agent',
    icon: BotIcon,
    group: 'setup',
    element: <HarnessPage path="agent" />,
  },
  {
    path: 'manifests',
    docs: `${MANAGEMENT_API}#manifests`,
    label: 'Manifests',
    icon: GitBranchIcon,
    group: 'setup',
    element: <HarnessPage path="manifests" />,
  },
  {
    path: 'eval',
    docs: `${MANAGEMENT_API}#eval`,
    label: 'Eval',
    icon: FlaskConicalIcon,
    group: 'setup',
    element: <HarnessPage path="eval" />,
  },
  {
    path: 'github',
    docs: GITHUB_DOCS,
    label: 'GitHub',
    icon: GithubIcon,
    group: 'setup',
    element: <HarnessPage path="github" />,
  },
];

export const GROUPS = [
  { key: 'happened', label: 'What happened' },
  { key: 'knows', label: 'What it knows' },
  { key: 'setup', label: 'How it’s set up' },
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
 * The three states on the rail worth a glance: jobs that are failing, recent
 * failures in the Activity page — from the same reads those pages make — and
 * skill drafts waiting for review. The last is the one in amber, because it is
 * the one that asks a person for something: an agent drafts overnight, and the
 * attention line, which reads approvals and questions, has no way to say so. They poll
 * behind two links, which the rail used to avoid on purpose; the trade is that
 * someone coming back sees where to go first without opening eight pages, which
 * is what "legible on return" asks.
 *
 * The Activity page's is bounded by time, where its page's header is bounded by count.
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
  /** A count of failures, a count waiting on a person, or an honest "could not check". */
  tone: 'failed' | 'blocked' | 'unknown';
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
/**
 * The address a nav row links to. Activity's glance counts failures in the last
 * 24 hours, and its link opened the page on "since your last visit" — often a
 * minute ago, so the click on "8 failed" landed on "Nothing ran". While the glance
 * says something, the link carries the window it was counted in.
 */
export function navSearch(path: HarnessPath, search: string, glance: Glance | undefined): string {
  if (path !== 'activity' || !glance) return search;
  const q = new URLSearchParams(search);
  q.set('since', ACTIVITY_GLANCE_SPAN);
  return `?${q}`;
}

export function glanceOf(
  poll: { data: unknown[] | undefined; error: unknown; lastOkAt: number | null },
  count: number,
  word: string,
  noun: string,
  span?: string,
  tone: 'failed' | 'blocked' = 'failed',
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
      tone,
    };
  }
  if (count === 0) return undefined;
  return { text: `${count} ${word}`, span, title: `${count} ${word}${within}`, tone };
}

export function useNavGlances(enabled = true): Record<string, Glance | undefined> {
  // Shared reads: on the Jobs page or the Activity page these ride the page's own
  // faster poll rather than sending the same request a second time.
  const jobs = useSharedPoll(JOBS_POLL_KEY, listJobs, { enabled, intervalMs: 30_000 });
  const activity = useActivityGlance(enabled);
  const drafts = useDraftGlance(enabled);
  const failingJobs = (jobs.data ?? []).filter(failing).length;
  return {
    jobs: glanceOf(jobs, failingJobs, 'failing', 'jobs'),
    activity,
    skills: drafts,
  };
}

/**
 * Activity's failures in the last day, on their own. Debug off this is the one
 * harness glance the sidebar always keeps: Activity is the page that answers
 * "what happened while I was away", which is the daily surface's question too.
 */
export function useActivityGlance(enabled = true): Glance | undefined {
  const audit = useSharedPoll(AUDIT_POLL_KEY, () => listAudit({ limit: ACTIVITY_FETCH }), {
    enabled,
    intervalMs: 30_000,
  });
  // Measured against the clock at render, which the 30s poll re-runs, so a
  // failure ages out within a tick of turning 24 hours old.
  const failedEvents = recentFailures(audit.data ?? [], Date.now());
  return glanceOf(audit, failedEvents, 'failed', 'activity', ACTIVITY_GLANCE_SPAN);
}

/**
 * The skill drafts waiting for review, on their own. Debug off, this is the one
 * glance the sidebar keeps: an agent drafts overnight, a draft waits on a person,
 * and no other surface — not the attention line, which reads approvals and
 * questions — says so.
 */
export function useDraftGlance(enabled = true): Glance | undefined {
  // Slower than the others: a draft waits hours, not seconds. A key without
  // `skills:read`, or a harness without the library, has nothing to review —
  // an answer, not a failed check, so it reads as none.
  const drafts = useSharedPoll(
    SKILL_QUEUE_POLL_KEY,
    () =>
      listSkillReviewQueue({ limit: SKILL_QUEUE_GLANCE_LIMIT }).then(
        (page) => page.items,
        (err: unknown) => {
          if (isSkillLibraryError(err) && (err.status === 403 || err.status === 404)) return [];
          throw err;
        },
      ),
    { enabled, intervalMs: 60_000 },
  );
  return draftGlance(drafts);
}

/** Drafts waiting, `100+` when the read came back full; amber, since each waits on a person. */
export function draftGlance(poll: {
  data: unknown[] | undefined;
  error: unknown;
  lastOkAt: number | null;
}): Glance | undefined {
  const count = poll.data?.length ?? 0;
  const glance = glanceOf(poll, count, 'waiting', 'skill drafts', undefined, 'blocked');
  if (!glance || glance.tone !== 'blocked') return glance;
  const n = count >= SKILL_QUEUE_GLANCE_LIMIT ? `${count}+` : String(count);
  const drafts = `${n} skill ${count === 1 ? 'draft' : 'drafts'} waiting for review`;
  return {
    ...glance,
    text: `${n} waiting`,
    title: glance.age ? `${drafts}, as of ${glance.age} ago — the latest check failed` : drafts,
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
        glance.tone === 'failed'
          ? 'text-state-failed'
          : glance.tone === 'blocked'
            ? 'text-state-blocked'
            : 'text-muted-foreground',
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
                    to={{ pathname: path, search: navSearch(path, search, glance[path]) }}
                    onClick={onNavigate}
                    // The sidebar's row grammar (`SidebarMenuButton`): the same list
                    // drawn two ways read as two lists.
                    className={({ isActive }) =>
                      cn(
                        'flex h-9 items-center gap-2 rounded-lg px-2.5 text-sm transition-[background-color,color,box-shadow] coarse:h-11',
                        'focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none',
                        isActive
                          ? 'bg-sidebar-accent font-semibold text-foreground shadow-sheet'
                          : 'text-muted-foreground hover:bg-sidebar-accent/70 hover:text-foreground',
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

/**
 * The page's own area while its chunk loads: the shape of a destination's header
 * and first rows, on the same measure, so the page arrives in place rather than
 * replacing a line of text. The pages themselves wait on skeletons; a bare
 * "Loading…" here was the one fallback that did not.
 */
function PageLoading() {
  const measure = useMeasure();
  return (
    <div role="status" className="flex flex-col">
      <span className="sr-only">Loading…</span>
      <div aria-hidden className="shrink-0 border-b border-border/60 px-4 py-3">
        <div className={cn('flex min-h-8 items-center gap-2.5', measure, measure && 'mx-auto')}>
          <Skeleton className="size-7 rounded-md" />
          <Skeleton className="h-4 w-28" />
        </div>
      </div>
      <div
        aria-hidden
        className={cn('flex flex-col gap-2 px-4 py-4', measure, measure && 'mx-auto w-full')}
      >
        <Skeleton className="h-8 w-full rounded-md" />
        <Skeleton className="h-8 w-full rounded-md" />
        <Skeleton className="h-8 w-2/3 rounded-md" />
      </div>
    </div>
  );
}

/**
 * Keep the current destination's row in view inside the scroller that holds it.
 *
 * The app sidebar's lower region is capped at 40% of the viewport and holds the
 * workspace above the harness's pages, so at a laptop's height (1728×941) the
 * Workbenches run sat below its fold — and on `/harness/jobs` the row saying where
 * you were was not on screen. Scrolls only the nearest scrolling ancestor, and only
 * by as much as it takes: `scrollIntoView` would also move every clipping ancestor
 * up the tree, including the sidebar content that is deliberately not a scroller.
 */
export function useActiveRowInView(nav: RefObject<HTMLElement | null>, at: string | undefined) {
  useEffect(() => {
    if (!at) return;
    const row = nav.current?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row) return;
    let box: HTMLElement | null = row.parentElement;
    while (
      box &&
      !(box.scrollHeight > box.clientHeight && /auto|scroll/.test(getComputedStyle(box).overflowY))
    )
      box = box.parentElement;
    if (!box) return;
    const r = row.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    // A row's height of margin, so the row does not land flush against the edge.
    const pad = r.height / 2;
    if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom + pad;
    else if (r.top < b.top) box.scrollTop -= b.top - r.top + pad;
  }, [nav, at]);
}

/**
 * Layout route for `/harness`.
 *
 * From 1024 the app sidebar is inline and carries the destinations itself on
 * every `/harness` page, debug or not, so this layout is the page alone. Between
 * 768 and 1024 the sidebar is a drawer, and the nav is a resident rail here instead — the destinations must be one
 * click away at every width, not one drawer away. Narrow, there is no room for
 * both, so `/harness` *is* the list and a destination is a page with a way back —
 * which is also why the index only redirects on a wide viewport. Redirecting on a
 * phone would mean the list could never be seen at all.
 */
export function HarnessLayout() {
  const wide = useMediaQuery('(min-width: 768px)');
  const sidebarInline = useMediaQuery(WORKSPACE_INLINE);
  // Inline, the sidebar lists the destinations on every `/harness` page — debug
  // or not — so this layout draws its own rail only while the sidebar is a
  // drawer. Debug off it used to draw one at every width, beside the sidebar, in
  // a second style: four columns and two lists for one set of pages.
  const atIndex = !!useMatch('/harness');
  const at = useMatch('/harness/:destination')?.params.destination;
  const destination = HARNESS_DESTINATIONS.find((d) => d.path === at);
  const place = destination?.label ?? 'Harness';
  const { search } = useHarnessAgent();
  const pane = useHarnessPane();

  // The tab strip names the page: nine open destinations all read "Felix chat".
  // Cleared on the way out, so the conversation's tab goes back to naming only
  // the run.
  useEffect(() => {
    setPresencePlace(place);
  }, [place]);
  useEffect(() => () => setPresencePlace(null), []);

  // The Activity page, not the first entry in the list. `/harness` is where an operator
  // comes back to, and the Activity page is the page that answers "what happened while
  // I was away"; Memory — first in the list — is empty for most tenants.
  if (atIndex && wide) return <Navigate to={{ pathname: 'activity', search }} replace />;

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
    <div ref={pane.row} className="flex min-h-0 flex-1">
      {wide && !sidebarInline && (
        // On the ground, as the sidebar is: the rail stands in for it here, and
        // a hairline on the sheet made it a fourth zone of its own.
        <div className="w-56 shrink-0 overflow-y-auto bg-ground">
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
      {pane.zone && <PaneColumn {...pane.zone} />}
      {pane.zone && <PaneOverlay {...pane.zone} />}
    </div>
  );
}

/**
 * The tab's side pane, beside a `/harness` page as it is beside the conversation: a skill opened
 * for editing from its page stays next to that page rather than sending the operator back to the
 * thread. It is the thread's pane — the same tabs and unsaved edits — so leaving for the thread
 * and back finds it as it was. None without a shell (a test mounting the layout alone).
 */
function useHarnessPane(): { row: RefObject<HTMLDivElement | null>; zone: PaneZoneProps | null } {
  const shell = useOptionalShell();
  const row = useRef<HTMLDivElement>(null);
  const layout = usePaneLayout(row);
  const threadId = shell?.threadId ?? '';
  const state = usePaneState(threadId);
  const turns = shell?.turns;
  const streaming = shell?.streaming ?? false;
  const changedPaths = useMemo(() => landedPaths(turns ?? []), [turns]);
  const runPaths = useMemo(() => {
    const lastUser = (turns ?? []).map((t) => t.role).lastIndexOf('user');
    return streaming && lastUser !== -1 ? landedPaths(turns ?? [], lastUser) : new Set<string>();
  }, [turns, streaming]);
  if (!shell) return { row, zone: null };
  return {
    row,
    zone: {
      threadId,
      changedPaths,
      runPaths,
      streaming,
      open: state.shown && state.items.length > 0,
      layout,
    },
  };
}
