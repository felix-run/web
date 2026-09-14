import { describeError } from '@felix/client';
import { Button } from '@felix/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@felix/ui/collapsible';
import { Skeleton } from '@felix/ui/skeleton';
import { ChevronRightIcon, CircleAlertIcon } from 'lucide-react';
import { createContext, type ReactNode, useContext } from 'react';
import { ErrorBoundary, PanelErrorFallback } from '@/components/error-boundary';
import { cn } from '@/lib/utils';

/**
 * The pieces every harness panel is built from.
 *
 * These were private to the inspector while the inspector was the only place the
 * harness was read. `/harness` reads the same data at a different lifetime — the
 * tenant-durable half, which outlives any one run — and it has to look like the
 * same product, so the disclosure row, the loading/error/empty body, the status
 * dot and the truncation footer live here rather than being reimplemented a
 * second time and drifting.
 */

/**
 * Harness status → the word the panel shows. The harness writes exactly these three
 * from `emit_agent_audit`; anything else is passed through untouched rather than
 * guessed at.
 *
 * There is deliberately no running or pending state here. An audit row is written
 * after the thing it describes has finished, so an in-flight call has no row at all —
 * which is why the feed is not where "is it working right now" gets answered.
 */
export const STATUS_LABEL: Record<string, string> = {
  ok: 'OK',
  error: 'Failed',
  denied: 'Denied',
};

/** The statuses that mean the harness did not do the thing. */
export function isFailure(status: string): boolean {
  return status === 'error' || status === 'failed' || status === 'denied';
}

/**
 * Wraps a whole section component, not its children.
 *
 * A section derives its view from the polled payload during its own render, so a
 * shape that does not match throws before any element it returns exists. A boundary
 * placed inside the section would never see it, and the error would keep climbing
 * until something caught it: the first version of this took the entire app down,
 * which is the failure it was added to prevent.
 */
export function SectionBoundary({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <ErrorBoundary
      label={`inspector:${title}`}
      fallback={(error, reset) => (
        <div className="px-3 py-2.5">
          <PanelErrorFallback error={error} reset={reset} what={title} />
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}

/**
 * One disclosure row plus its body. `meta` is the at-a-glance value in the header,
 * the thing that should make expanding unnecessary most of the time.
 */
/**
 * Whether a `Section` is being read as a disclosure row or as a whole page.
 *
 * A context rather than a prop because the answer belongs to the *surface*, not
 * to the section: the same Memory or Ledger component is a row in the inspector's
 * stack and a page under `/harness`, and threading a flag through every one of
 * them would be a prop that exists only to be forwarded. It also means a section
 * moved between the two surfaces needs no edit at all.
 */
type SectionChrome =
  /** A row in the inspector's stack: collapsible, header always visible. */
  | 'disclosure'
  /** A `/harness` page: static heading, body fills the panel. */
  | 'panel'
  /** A `/harness` page whose *host* draws the heading — see the Ledger. */
  | 'bare';

const PanelMode = createContext<SectionChrome>('disclosure');

/** Marks everything inside as a `/harness` page rather than an inspector row. */
export function PanelModeProvider({
  children,
  chrome = 'panel',
}: {
  children: ReactNode;
  chrome?: SectionChrome;
}) {
  return <PanelMode.Provider value={chrome}>{children}</PanelMode.Provider>;
}

export function Section({
  icon,
  title,
  meta,
  metaTone,
  open,
  onToggle,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  meta?: string;
  /**
   * `attention` is amber: something is waiting on a person. `failed` is red:
   * something already went wrong and nobody is being asked to act. Collapsing the
   * two would put the panel's two most different states in one colour, which is the
   * whole thing the state palette exists to keep apart.
   */
  metaTone?: 'default' | 'attention' | 'failed';
  open: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const chrome = useContext(PanelMode);

  // The Ledger draws one heading for two halves, so its halves draw none: a
  // section heading under a tab strip that already names the same thing is the
  // label repeated, and it costs a row on every screen.
  if (chrome === 'bare') return <>{children}</>;

  // A page does not disclose: there is nothing else on it to collapse *to*, and a
  // header that hides the only content on screen is a control whose best outcome
  // is an empty page. The heading, the icon and the `meta` count all stay — they
  // are what the row was worth reading at a glance for.
  if (chrome === 'panel') {
    // The heading names the region rather than merely sitting inside it: a
    // `<section>` with no accessible name is announced as an anonymous region,
    // which is worse than no landmark at all.
    const headingId = `panel-heading-${title.replace(/\W+/g, '-').toLowerCase()}`;
    return (
      <section aria-labelledby={headingId} className="flex min-h-0 flex-1 flex-col">
        <header className="flex shrink-0 items-center gap-2 border-b border-border/60 px-4 py-3">
          <span className="shrink-0 text-muted-foreground">{icon}</span>
          <h2 id={headingId} className="flex-1 truncate text-sm font-semibold">
            {title}
          </h2>
          {meta ? (
            <span
              className={cn(
                'shrink-0 text-xs tabular-nums',
                metaTone === 'attention' &&
                  'rounded-full bg-state-blocked/15 px-1.5 py-0.5 font-medium text-state-blocked',
                metaTone === 'failed' &&
                  'rounded-full bg-state-failed/15 px-1.5 py-0.5 font-medium text-state-failed',
                (!metaTone || metaTone === 'default') && 'text-muted-foreground',
              )}
            >
              {meta}
            </span>
          ) : null}
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
      </section>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={onToggle}>
      <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <ChevronRightIcon
          aria-hidden
          className="size-3.5 shrink-0 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-90"
        />
        <span className="shrink-0 text-muted-foreground">{icon}</span>
        <span className="flex-1 truncate text-sm font-semibold">{title}</span>
        {meta ? (
          <span
            className={cn(
              'shrink-0 text-xs tabular-nums',
              metaTone === 'attention' &&
                'rounded-full bg-state-blocked/15 px-1.5 py-0.5 font-medium text-state-blocked',
              metaTone === 'failed' &&
                'rounded-full bg-state-failed/15 px-1.5 py-0.5 font-medium text-state-failed',
              (!metaTone || metaTone === 'default') && 'text-muted-foreground',
            )}
          >
            {meta}
          </span>
        ) : null}
      </CollapsibleTrigger>
      <CollapsibleContent className="px-3 pb-3">{children}</CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Loading / error / empty handling inside an expanded section.
 *
 * `status` is the only live region: these bodies repaint on every poll, so marking the
 * lists themselves live would re-read every row every few seconds. A screen reader
 * announces a live region only when its text changes, so an unchanged count is silent.
 */
export function SectionBody({
  loading,
  error,
  doing,
  empty,
  emptyText,
  status,
  onRetry,
  children,
}: {
  loading: boolean;
  /** Whatever was caught, unstringified — see `usePoll` and `ErrorNotice`. */
  error: unknown;
  /** Verb phrase completing "Could not …", used to write the failure message. */
  doing: string;
  empty?: boolean;
  emptyText: string;
  status?: string;
  /** Re-runs this section's fetch. Without it a failed poll is a dead end. */
  onRetry?: () => void;
  children: React.ReactNode;
}) {
  // A failed fetch leaves no data, which also reads as "empty". Showing both at once
  // says the harness is idle *and* unreachable; the error is the true one.
  if (error) {
    const described = describeError(error, doing);
    // No sr-only status line here: `role="alert"` is already a live region, and
    // carrying the same text in both makes a screen reader read the failure twice.
    return (
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-lg border border-state-failed/30 bg-state-failed/10 px-2.5 py-2 text-xs text-state-failed"
      >
        <div className="flex items-start gap-2">
          <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0" />
          <div className="min-w-0">
            <p className="break-words">{described.message}</p>
            {/* The mono face separates the raw status from the sentence; dimming it
                further would put it under the contrast floor. */}
            <p className="mt-0.5 font-mono break-words">{described.detail}</p>
          </div>
        </div>
        {onRetry && (
          <Button size="sm" variant="outline" className="h-7 self-start text-xs" onClick={onRetry}>
            Try again
          </Button>
        )}
      </div>
    );
  }

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {loading && !status ? 'Loading' : status}
      </p>
      {loading && (
        <div className="space-y-1.5">
          <Skeleton className="h-8 w-full rounded-md" />
          <Skeleton className="h-8 w-full rounded-md" />
        </div>
      )}
      {!loading && empty && <p className="text-sm text-muted-foreground">{emptyText}</p>}
      {!loading && !empty && children}
    </>
  );
}

/** Footer that names what a render cap left out, so the list never lies by omission. */
export function Truncated({
  shown,
  total,
  noun,
  /**
   * Set when `total` is the size of a fetch window rather than everything there is.
   * Without it the footer reads "12 of 60" and presents a request parameter as a
   * census of the harness — the exact lie this footer was added to prevent.
   */
  windowed,
}: {
  shown: number;
  total: number;
  noun: string;
  windowed?: boolean;
}) {
  if (total <= shown) return null;
  return (
    <p className="mt-2 text-xs text-muted-foreground">
      Showing {shown} of {windowed ? `the last ${total}` : total} {noun}
    </p>
  );
}

export function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn('min-w-0 break-words', mono && 'font-mono')}>{value}</dd>
    </>
  );
}

/**
 * Status as a word plus a dot. The dot is decorative — the word carries the state, so
 * this never encodes anything in colour alone.
 *
 * The raw harness string stays in `title` for anyone matching a row against a log line;
 * what shows is `STATUS_LABEL`. Previously the raw value was rendered directly under a
 * `capitalize` class, which turned `ok` into the non-word "Ok" and let two rows meaning
 * the same thing read differently if the harness ever varied its spelling.
 */
export function StatusDot({ status }: { status: string }) {
  const ok = status === 'ok' || status === 'success' || status === 'completed';
  const bad = status === 'error' || status === 'failed' || status === 'denied';
  return (
    <span
      title={status}
      className={cn(
        'inline-flex items-center gap-1 text-xs',
        ok && 'text-state-done',
        bad && 'text-state-failed',
        !ok && !bad && 'text-muted-foreground',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'size-1.5 rounded-full',
          ok && 'bg-state-done',
          // `--state-failed` is the text-weight red; `--destructive` is tuned to carry
          // white on a solid fill and was measurably the wrong one for a 6px dot.
          bad && 'bg-state-failed',
          !ok && !bad && 'bg-muted-foreground/50',
        )}
      />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

/** Audit rows have arrived in both units; normalise before doing arithmetic on one. */
export function tsToMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts;
}

export function relTime(ts: number): string {
  const ms = tsToMs(ts);
  const diff = Date.now() - ms;
  // A burst of tool calls lands inside one minute, and "now" on every row of it
  // erases the sequence. Seconds keep the rows distinguishable at the only moment
  // anyone is watching them arrive.
  if (diff < 5_000) return 'now';
  if (diff < 60_000) return `${Math.round(diff / 1_000)}s`;
  if (diff < 3_600_000) return `${Math.round(diff / 60_000)}m`;
  if (diff < 86_400_000) return `${Math.round(diff / 3_600_000)}h`;
  return `${Math.round(diff / 86_400_000)}d`;
}

export interface SkillState {
  declared: string[];
  active: string[];
}
