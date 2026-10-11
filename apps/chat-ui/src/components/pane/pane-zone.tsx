import { Sheet, SheetContent, SheetTitle } from '@felix/ui/sheet';
import { lazy, Suspense } from 'react';
import { PaneDivider } from '@/components/pane/pane-divider';
import type { PaneLayout } from '@/components/pane/use-pane-layout';
import { setPaneShown } from '@/lib/side-pane';
import { cn } from '@/lib/utils';

/** The side pane loads with the first thing opened in it. */
const SidePane = lazy(() =>
  import('@/components/pane/side-pane').then((m) => ({ default: m.SidePane })),
);

/**
 * The narrow-width drawers' motion, at the inline rails' speed (`RAIL_MS`).
 * The primitive's own 500ms in / 300ms out, `ease-in-out`, made a zone that
 * snaps open at one width crawl open at another. `ease-out` because the drawer
 * answers a click: it should start fast and settle, not ramp up first.
 */
export const DRAWER_MOTION =
  'ease-out data-[state=closed]:duration-200 data-[state=open]:duration-200 motion-reduce:animate-none';

export interface PaneZoneProps {
  threadId: string;
  /** Files a write or edit landed on, over the thread. */
  changedPaths: ReadonlySet<string>;
  /** …in the run still in flight. */
  runPaths: ReadonlySet<string>;
  streaming: boolean;
  /** Something open and the pane not hidden. */
  open: boolean;
  layout: PaneLayout;
}

function Pane({ onBack, ...props }: PaneZoneProps & { onBack?: () => void }) {
  return (
    <Suspense fallback={null}>
      <SidePane
        threadId={props.threadId}
        changedPaths={props.changedPaths}
        runPaths={props.runPaths}
        streaming={props.streaming}
        {...(onBack ? { onBack } : {})}
      />
    </Suspense>
  );
}

/**
 * The pane beside the page, behind a divider — where the row it shares has room for both
 * (`usePaneLayout`). Rendered inside that row, after the page's own column. The conversation
 * and every `/harness` page draw it the same way, so an editor opened beside one is the same
 * editor beside the other.
 */
export function PaneColumn(props: PaneZoneProps) {
  const { open, layout } = props;
  if (!open || !layout.split) return null;
  return (
    <>
      <PaneDivider
        share={layout.share}
        min={layout.min}
        max={layout.max}
        onChange={layout.onChange}
        onCommit={layout.onCommit}
        onReset={layout.onReset}
        controls="side-pane"
      />
      <div
        id="side-pane"
        style={{ width: `${(layout.share * 100).toFixed(2)}%` }}
        className="flex min-h-0 shrink-0 animate-in fade-in-0 slide-in-from-right-3 duration-200 ease-out motion-reduce:animate-none"
      >
        <Pane {...props} />
      </div>
    </>
  );
}

/** The pane over the whole sheet, with a way back — where the row cannot hold both. */
export function PaneOverlay(props: PaneZoneProps) {
  const { open, layout, threadId } = props;
  if (layout.split) return null;
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next) setPaneShown(threadId, false);
      }}
    >
      <SheetContent
        side="right"
        showCloseButton={false}
        data-shortcut-surface="pane"
        className={cn('w-full max-w-full gap-0 p-0 sm:max-w-none', DRAWER_MOTION)}
      >
        <SheetTitle className="sr-only">Side pane</SheetTitle>
        <Pane {...props} onBack={() => setPaneShown(threadId, false)} />
      </SheetContent>
    </Sheet>
  );
}
