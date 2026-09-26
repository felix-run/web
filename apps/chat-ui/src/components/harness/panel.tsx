import type { ReactNode } from 'react';
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
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex min-h-0 flex-1 flex-col', className)}>{children}</div>;
}

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
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-2 border-b border-border/60 px-4 py-3">
      {/* Normalised here so a section's 14px row icon and a page's 16px one are
          the same size on the page, where the nav beside it draws 16px. */}
      <span aria-hidden className="shrink-0 text-muted-foreground [&>svg]:size-4">
        {icon}
      </span>
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

export function PanelHeader({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('shrink-0 space-y-1 border-b border-border/60 px-4 py-3', className)}>
      {children}
    </div>
  );
}

export function PanelTitle({ children, className }: { children: ReactNode; className?: string }) {
  return <h2 className={cn('text-sm font-semibold', className)}>{children}</h2>;
}

export function PanelDescription({ children }: { children: ReactNode }) {
  return <p className="text-xs text-muted-foreground">{children}</p>;
}

/** Scrolls; the header above it does not. */
export function PanelBody({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('min-h-0 flex-1 overflow-y-auto', className)}>{children}</div>;
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
          <PanelHeader>
            <PanelTitle>{title}</PanelTitle>
            <PanelDescription>
              This panel failed to render. The rest of Felix is unaffected.
            </PanelDescription>
          </PanelHeader>
          <PanelBody className="p-4">
            <PanelErrorFallback error={error} reset={reset} what={title} />
          </PanelBody>
        </Panel>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
