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
