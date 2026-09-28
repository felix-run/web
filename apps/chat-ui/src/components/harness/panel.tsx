import { Button } from '@felix/ui/button';
import {
  ChevronLeftIcon,
  ExternalLinkIcon,
  PlusIcon,
  TriangleAlertIcon,
  XIcon,
} from 'lucide-react';
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

/**
 * What a `/harness` page draws where its rows would be, when there are none.
 *
 * It was one muted sentence at the top-left of the measure, which in a
 * disclosure row is right and on a page three times that wide is a line
 * floating in a void — the page read as unfinished rather than as empty. The
 * frame takes the measure's full width and a list's worth of height, so the
 * sentence sits in the space the rows will occupy and says that is what it is.
 * Dashed, because a solid border is how this app draws a thing that exists —
 * and on `muted-foreground/30` rather than `border`, which in dark is so close
 * to the page that the dashes did not read and the frame looked like a smudge.
 */
export function PageEmpty({ children }: { children: ReactNode }) {
  return (
    <div
      data-page-empty
      className="flex min-h-40 items-center justify-center rounded-lg border border-dashed border-muted-foreground/30 px-6 py-10"
    >
      <p className="max-w-prose text-center text-sm text-muted-foreground">{children}</p>
    </div>
  );
}

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

/** Where the docs site lives. Public, so one origin serves every deployment. */
export const DOCS_ORIGIN = 'https://docs.felix.run';

/**
 * The docs page for whatever `/harness` destination is on screen, which its
 * header links to. A context, set by the layout from the destination's own
 * entry, so no page has to thread a URL through to the header it draws; a page
 * whose reference depends on its own state (the Ledger's two halves) passes
 * `docs` to `PageHeader` instead.
 */
export const PageDocs = createContext<string | null>(null);

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
  valueLead,
  valueTone = 'default',
  valueMono,
  headingId,
  controls,
  docs,
}: {
  icon: ReactNode;
  title: string;
  value?: string | undefined;
  /**
   * The neutral part of a toned value, drawn before its chip. The Ledger's
   * `last 60 events · 3 failed` was one red pill, so the window — a denominator,
   * not a fault — was coloured as alarm too.
   */
  valueLead?: string | undefined;
  /**
   * `attention` is amber — something waits on a person; `failed` is red —
   * something already went wrong and nobody is being asked. Kept apart for the
   * reason the state palette exists.
   */
  valueTone?: 'default' | 'attention' | 'failed' | undefined;
  valueMono?: boolean;
  headingId?: string;
  controls?: ReactNode;
  /** A docs URL, overriding the destination's own (`PageDocs`). */
  docs?: string;
}) {
  const measure = useMeasure();
  const back = useContext(PageBack);
  // Read unconditionally: `docs ?? useContext(...)` would call the hook on
  // some renders and not others.
  const destinationDocs = useContext(PageDocs);
  const docsHref = docs ?? destinationDocs;
  return (
    <header className="shrink-0 border-b border-border/60 px-4 py-3">
      {/* `min-h-8`: the height of the tallest control a header carries, so the
          rule under it sits on one line across all eight pages. It moved by a few
          pixels whenever a page had controls, which the eye reads as the page
          jumping on navigation. */}
      <div className={cn('flex min-h-8 flex-wrap items-center gap-x-2 gap-y-2', measure)}>
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
        {value && valueLead ? (
          <span className="min-w-0 truncate text-xs text-muted-foreground tabular-nums">
            {valueLead}
          </span>
        ) : null}
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
        {controls || docsHref ? (
          <div className="ml-auto flex items-center gap-2">
            {controls}
            {/*
              Last, and quiet: the reference for what this page shows — which
              route it reads, what its fields mean. The operator configured the
              harness and does not need it daily, which is why it is a text link
              at the end rather than anything louder; but a page that says
              "metered but unpriced" or "soft forget" should say where that is
              written down. A new tab, because this page is an instrument that is
              often mid-read.
            */}
            {docsHref && (
              <a
                href={docsHref}
                target="_blank"
                rel="noreferrer"
                aria-label={`${title} in the docs (opens in a new tab)`}
                className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
              >
                Docs
                <ExternalLinkIcon aria-hidden className="size-3" />
              </a>
            )}
          </div>
        ) : null}
      </div>
    </header>
  );
}

/**
 * A page's view switch, drawn in its header.
 *
 * It looks like the Ledger's Activity/Usage switch because it sits in the same
 * place and does a comparable job, but it is a toggle group rather than tabs:
 * Memory's and Corpus's views change the *input* above one shared list, so
 * there is no panel per view for a `tabpanel` to name. `aria-pressed` in a
 * named group promises only what this is. It lived in the page body while the
 * Ledger's lived in the header — two places for one kind of control.
 */
export function ViewSwitch<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<readonly [T, string]>;
  onChange: (next: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex h-8 items-center rounded-lg bg-muted p-[3px] text-muted-foreground"
    >
      {options.map(([id, text]) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={cn(
            'h-full rounded-md px-2.5 text-xs font-medium whitespace-nowrap transition-colors',
            'focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none',
            value === id
              ? 'bg-background text-foreground shadow-sm dark:bg-input/30'
              : 'hover:text-foreground',
          )}
        >
          {text}
        </button>
      ))}
    </div>
  );
}

/**
 * The wrapper for the form a `CreateToggle` opens. A rule under it, because the
 * page goes on below — the list, a view's own input — and without one Memory's
 * "Remember it" sat against the As-of field as if they were one form.
 */
export const CREATE_FORM = 'mb-5 border-b border-border/60 pb-5';

/**
 * The one way a `/harness` page offers to create something: a header toggle
 * whose form opens as the page's first section.
 *
 * There were four — a header toggle on Jobs, an "Add" in Memory's and Corpus's
 * view strips, an always-open row on Eval, a section at the foot of Manifests —
 * so the operator relearned where "add" lived on every page.
 *
 * Open is more than a fill change: the plus becomes a cross, so the same button
 * visibly reads as the way to close what it opened.
 */
export function CreateToggle({
  open,
  onToggle,
  controls,
  children,
}: {
  open: boolean;
  onToggle: () => void;
  /** The id of the form this opens, for `aria-controls`. */
  controls: string;
  children: ReactNode;
}) {
  return (
    <Button
      size="sm"
      variant={open ? 'secondary' : 'outline'}
      className="gap-1"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
    >
      {open ? <XIcon className="size-3.5" /> : <PlusIcon className="size-3.5" />}
      {children}
    </Button>
  );
}

/**
 * Names the harness gave — tools, skills, servers — as a mono list, the same on
 * every page that shows them. Agent drew these as plain text and Skills drew the
 * same skills as pills, one page apart. A pill says "tag" or "filter", neither of
 * which these are, and seventeen of them made the densest part of a page its
 * loudest.
 *
 * `quiet` names are drawn muted: a declared skill that is not active is still a
 * name worth listing, just not the one the eye should land on.
 */
export function NameList({ names, quiet = [] }: { names: string[]; quiet?: string[] }) {
  return (
    <ul className="flex flex-wrap gap-x-1 font-mono text-sm">
      {names.map((n, i) => (
        <li key={n} className={quiet.includes(n) ? 'text-muted-foreground' : undefined}>
          {n}
          {i < names.length - 1 && (
            <span aria-hidden className="text-muted-foreground">
              ,
            </span>
          )}
        </li>
      ))}
    </ul>
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
    // Padding outside the measure, as `PageHeader` has it: inside, the rows
    // came out 32px narrower than the header row and ended short of the
    // controls that act on them. The Ledger's tabs were the one page right.
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      <div className={cn(measure, className)}>{children}</div>
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
    // A container query, not a breakpoint: the pane is what is narrow, and a
    // label column of up to 11rem took half of a phone's width and stacked nine
    // tool chips one per line beside it. Under ~28rem each value goes under its
    // label instead.
    <div className="@container">
      <dl className="grid grid-cols-1 gap-x-4 gap-y-0.5 text-sm @md:grid-cols-[minmax(7rem,11rem)_minmax(0,1fr)] @md:gap-y-1.5">
        {children}
      </dl>
    </div>
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
      <dt className="mt-1.5 min-w-0 text-muted-foreground first:mt-0 @md:mt-0">{label}</dt>
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
