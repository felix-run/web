import { ChevronLeftIcon, TriangleAlertIcon } from 'lucide-react';
import { createContext, type ReactNode, useContext, useId } from 'react';
import { Link } from 'react-router';
import { ErrorBoundary, PanelErrorFallback } from '@/components/error-boundary';
import { cn } from '@/lib/utils';

/**
 * The chrome a `/harness` destination is drawn in.
 *
 * These four were slide-over sheets reached from an unlabelled ellipsis menu.
 * ROADMAP.md's open question was where they belonged, and the answer turned out
 * not to be "somewhere easier to find" — they were not hard to find, they had no
 * home. A sheet is the right form for something you glance at and dismiss while
 * keeping your place; it is the wrong one for a surface you navigate *to*, which
 * is what an operator does with jobs, manifests and eval.
 *
 * So the sheet chrome becomes panel chrome: the same header, title and
 * description, minus the overlay, the escape handling and the modal trap. What a
 * panel gains instead is an address.
 */
export function Panel({
  children,
  className,
  fullBleed = false,
}: {
  children: ReactNode;
  className?: string;
  /**
   * Let this page's rows run the full width of the pane. The exception, not the
   * rule: see `READING_MEASURE`.
   */
  fullBleed?: boolean;
}) {
  return (
    <FullBleed.Provider value={fullBleed}>
      <div className={cn('flex min-h-0 flex-1 flex-col', className)}>{children}</div>
    </FullBleed.Provider>
  );
}

/**
 * The width a `/harness` page holds its rows to when they are read across rather
 * than scanned down: a status is read with its name rather than found 1300px
 * away. One constant so a page's rows and its header's row cannot drift apart —
 * they did, which is how a switch ended up nowhere near the rows it switched.
 *
 * **It is the default, not an opt-in.** The Ledger opted in and the four
 * workbenches did not, so Agent drew its labels ~1200px from their values and
 * Manifests parked its only button across the pane from the field it submits —
 * the same fault the constant was written to fix, back on four pages because
 * nobody had remembered to ask for the fix. A page that genuinely needs the width
 * says so with `<Panel fullBleed>`.
 */
export const READING_MEASURE = 'max-w-3xl';

const FullBleed = createContext(false);

/** The measure this page's rows take: `READING_MEASURE`, unless it opted out. */
export function useMeasure(): string {
  return useContext(FullBleed) ? '' : READING_MEASURE;
}

/**
 * Where a destination's header puts the way back to the list, when there is one.
 *
 * Narrow, `/harness` is the list and a destination is a page, so the page needs
 * a way back. It used to be a row of its own above the header — ~40px spent on
 * one chevron, on the screen with the least height to spend. The header already
 * leads with an icon that says what the page is; narrow, the nav beside it is
 * gone and that icon's job is better done by the way out. `HarnessLayout`
 * provides the target; everywhere else it is `null` and the icon stays.
 */
export const PageBack = createContext<{ to: string; label: string } | null>(null);

/**
 * The one header every `/harness` destination draws: icon · title · one
 * at-a-glance value, with any controls to the right — or on a second row when
 * the pane is too narrow for both, which `flex-wrap` decides rather than a
 * breakpoint.
 *
 * It exists because the eight pages had arrived at three grammars. Memory drew
 * an icon, its title and a bare `0` at the far edge; the Ledger a title and a
 * segmented control with no icon; Jobs an icon, a title the nav did not use and
 * a descriptive subline. Each was reasonable alone, and together they made the
 * same place look like three products.
 *
 * The value carries its unit — `0 memories`, not `0` — because a number with
 * nothing beside it is a number the reader has to decode against the title. It
 * sits next to the title rather than at the far edge: at 1300px a count parked
 * across the pane from the word it counts is two things to find. And it is only
 * ever drawn from data the page already fetched; a request made for a label is
 * a poll nobody is reading.
 *
 * `valueMono` follows the Provenance Rule — a manifest id is something the
 * harness said, a count is something we said about it.
 *
 * The row takes the page's measure (`useMeasure`) while the rule under it stays
 * full width, because the rule separates the header from the pane and the row
 * belongs to the content: the controls end where the rows they act on end.
 * Unmeasured, the Ledger's Activity/Usage switch sat at the far edge of a 1300px
 * pane with every row it switched ~500px to its left.
 */
export function PageHeader({
  icon,
  title,
  value,
  valueTone = 'default',
  valueMono,
  headingId,
  controls,
}: {
  icon: ReactNode;
  title: string;
  value?: string | undefined;
  /**
   * `attention` is amber — something waits on a person; `failed` is red —
   * something already went wrong and nobody is being asked. Kept apart for the
   * reason the state palette exists.
   */
  valueTone?: 'default' | 'attention' | 'failed' | undefined;
  valueMono?: boolean;
  headingId?: string;
  controls?: ReactNode;
}) {
  const measure = useMeasure();
  const back = useContext(PageBack);
  return (
    <header className="shrink-0 border-b border-border/60 px-4 py-3">
      <div className={cn('flex flex-wrap items-center gap-x-2 gap-y-2', measure)}>
        {back ? (
          // Pulled left by its own padding so the chevron sits on the column the
          // icon would have, and the title does not move between widths.
          <Link
            to={back.to}
            aria-label={back.label}
            className="-my-1 -ml-1.5 flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
          >
            <ChevronLeftIcon aria-hidden className="size-4" />
          </Link>
        ) : (
          // Normalised here so a section's 14px row icon and a page's 16px one
          // are the same size on the page, where the nav beside it draws 16px.
          <span aria-hidden className="shrink-0 text-muted-foreground [&>svg]:size-4">
            {icon}
          </span>
        )}
        <h2 id={headingId} className="truncate text-sm font-semibold">
          {title}
        </h2>
        {value ? (
          <span
            className={cn(
              'min-w-0 truncate text-xs tabular-nums',
              valueMono && 'font-mono',
              valueTone === 'attention' &&
                'rounded-full bg-state-blocked/15 px-1.5 py-0.5 font-medium text-state-blocked',
              valueTone === 'failed' &&
                'rounded-full bg-state-failed/15 px-1.5 py-0.5 font-medium text-state-failed',
              valueTone === 'default' && 'text-muted-foreground',
            )}
          >
            {value}
          </span>
        ) : null}
        {controls ? <div className="ml-auto flex items-center gap-2">{controls}</div> : null}
      </div>
    </header>
  );
}

/**
 * A count for a header value: `plural(1, 'job')` → `1 job`.
 *
 * `cap` is the fetch's `limit`. A list that came back exactly that long is a
 * list the harness stopped sending, not a census, so it reads `50+ memories`
 * rather than a total nobody counted.
 */
export function plural(n: number, one: string, many = `${one}s`, cap?: number): string {
  const count = cap !== undefined && n >= cap ? `${cap.toLocaleString()}+` : n.toLocaleString();
  return `${count} ${n === 1 ? one : many}`;
}

/**
 * The page below the header: scrolls, while the header above it does not, and
 * holds its rows to the page's measure. The scrollbar stays at the pane's edge
 * rather than the measure's, which is where a hand reaching for it expects it.
 */
export function PanelBody({ children, className }: { children: ReactNode; className?: string }) {
  const measure = useMeasure();
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className={cn('p-4', measure, className)}>{children}</div>
    </div>
  );
}

/**
 * One part of a page: a rule, a heading, its rows.
 *
 * The workbenches drew each part as a bordered, tinted box — eight of them
 * stacked on Agent — which is the scaffolded-card default this product names as
 * its nearest failure, and which made a page of *parts* look like a page of
 * *things*. A part is separated by a rule and ranked by its heading instead, the
 * way the Ledger's rows are, so the eye goes to what the heading says rather than
 * to how many boxes there are.
 *
 * The heading is a real `h3`. Agent's were `div`s, so the page had one heading
 * and a screen reader navigating by heading skipped every part of it.
 */
export function PageSection({
  title,
  meta,
  actions,
  children,
  className,
}: {
  title: string;
  /** A short at-a-glance value beside the heading, as `PageHeader` has. */
  meta?: ReactNode;
  /** Controls for this part, at the end of its heading row. */
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn(
        // `-of-type`, not `first:`: a page's sections share a parent with its
        // status line and intro, so the first *section* is rarely the first child.
        'border-t border-border/60 pt-3 pb-5 first-of-type:border-t-0 first-of-type:pt-0 last-of-type:pb-0',
        className,
      )}
    >
      <div className="mb-2 flex min-h-7 flex-wrap items-center gap-x-2 gap-y-1">
        <h3 id={id} className="text-sm font-semibold">
          {title}
        </h3>
        {meta ? <span className="text-xs text-muted-foreground tabular-nums">{meta}</span> : null}
        {actions ? <div className="ml-auto flex items-center gap-2">{actions}</div> : null}
      </div>
      {children}
    </section>
  );
}

/**
 * Label/value rows read across: the label in a fixed column, the value beside it.
 *
 * Right-aligned values in a full-width row put `Pattern` and `react` ~1200px
 * apart at a desktop width — a label nobody could read *with* its value. A
 * grid keeps them a gutter apart at every width, and a `dl` says to a screen
 * reader what the visual pairing says to everyone else.
 */
export function Facts({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[minmax(7rem,11rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-sm">
      {children}
    </dl>
  );
}

/**
 * One row of `Facts`. `mono` follows the Provenance Rule: a value the harness
 * named (`react`, `github`) is set in mono, a value we wrote about it is not.
 * `absent` is a reading rather than a blank, so an unset field still says so.
 */
export function Fact({
  label,
  children,
  mono = false,
  absent,
}: {
  label: ReactNode;
  children?: ReactNode;
  mono?: boolean;
  absent?: string;
}) {
  const empty = children === undefined || children === null || children === '';
  return (
    <>
      <dt className="min-w-0 text-muted-foreground">{label}</dt>
      <dd
        className={cn('min-w-0 break-words', empty ? 'text-muted-foreground' : mono && 'font-mono')}
      >
        {empty ? (absent ?? '—') : children}
      </dd>
    </>
  );
}

/**
 * Error boundary for one `/harness` destination.
 *
 * This is what `SheetBoundary` became. The reason it existed has not changed —
 * `AgentSheet` once read a field the harness has never sent and took the whole
 * application down every time it was opened — but the shape has: each panel is
 * wrapped individually rather than the group, because a panel throws during its
 * *own* render and a boundary around the group would catch the first failure and
 * take its siblings with it.
 *
 * The fallback keeps the panel chrome. A boundary that swallowed it too would
 * leave the failure as a bare fragment where the nav expects a panel, so the
 * surface would look broken rather than look like one destination that failed.
 */
export function PanelBoundary({ title, children }: { title: string; children: ReactNode }) {
  return (
    <ErrorBoundary
      label={`harness:${title}`}
      fallback={(error, reset) => (
        <Panel>
          {/* The page's own header, so the fallback keeps the title the nav
              used and, narrow, the way back to the list. */}
          <PageHeader
            icon={<TriangleAlertIcon />}
            title={title}
            value="failed to render"
            valueTone="failed"
          />
          <PanelBody className="space-y-2">
            <p className="text-sm text-muted-foreground">
              This page failed to render. The rest of Felix is unaffected.
            </p>
            <PanelErrorFallback error={error} reset={reset} what={title} />
          </PanelBody>
        </Panel>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
