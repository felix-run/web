import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@felix/ui/sheet';
import type { ReactNode } from 'react';
import { ErrorBoundary, PanelErrorFallback } from '@/components/error-boundary';

/**
 * Error boundary for a slide-over sheet.
 *
 * The four sheets were mounted bare as siblings of the transcript, so a throw in
 * any of them escaped to the root boundary and replaced the entire application.
 * That was not hypothetical: `AgentSheet` read a field the harness has never sent
 * and took the app down every single time it was opened.
 *
 * The inspector solved this a while ago by wrapping each *section component*,
 * because a section throws during its own render and a boundary around its
 * children never sees it. Same rule here: this wraps the sheet component itself.
 *
 * The fallback re-renders the sheet chrome rather than a bare panel. A boundary
 * that swallowed the `<Sheet>` too would leave the failure as a fragment at the
 * app root, with no overlay, no escape handling, and nothing to close — the
 * operator would be looking at an error they could not dismiss.
 */
export function SheetBoundary({
  open,
  onOpenChange,
  title,
  className,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Sheet name, used for the fallback heading and the console label. */
  title: string;
  /** Width classes of the sheet being wrapped, so the fallback is the same size. */
  className?: string;
  children: ReactNode;
}) {
  return (
    <ErrorBoundary
      label={`sheet:${title}`}
      fallback={(error, reset) => (
        <Sheet
          open={open}
          // Closing clears the caught error, so reopening is a fresh attempt rather
          // than a permanent tombstone. If the cause persists it will throw again
          // and land back here; if it was one malformed response, it recovers.
          onOpenChange={(next) => {
            if (!next) reset();
            onOpenChange(next);
          }}
        >
          <SheetContent side="right" className={className ?? 'w-full gap-0 p-0 sm:max-w-lg'}>
            <SheetHeader className="border-b">
              <SheetTitle>{title}</SheetTitle>
              <SheetDescription>
                This panel failed to render. The rest of Felix is unaffected.
              </SheetDescription>
            </SheetHeader>
            <div className="p-4">
              <PanelErrorFallback error={error} reset={reset} what={title} />
            </div>
          </SheetContent>
        </Sheet>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
