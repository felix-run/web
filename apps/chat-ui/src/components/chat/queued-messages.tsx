import { Button } from '@felix/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@felix/ui/tooltip';
import { ArrowDown, ArrowUp, CornerDownRight, ImageIcon, Pencil, Play, X } from 'lucide-react';
import type { ReactNode } from 'react';
import type { QueuedMessage } from '@/hooks/use-message-queue';
import { cn } from '@/lib/utils';

export type QueuedMessagesProps = {
  items: QueuedMessage[];
  paused: boolean;
  /** A run is in flight, so a message can steer it. */
  running: boolean;
  onSteer(id: string): void;
  onEdit(id: string): void;
  onMove(id: string, delta: -1 | 1): void;
  onRemove(id: string): void;
  onResume(): void;
  onClear(): void;
};

/**
 * What the operator has written mid-run and not yet sent, on top of the composer.
 *
 * Drawn as a tray the composer overlaps rather than a list somewhere else,
 * because these are the composer's own output, in the order they will go: the
 * first row is the next message. The status line says *when* that is, which is
 * the thing a queue that sends by itself has to be honest about.
 */
export function QueuedMessages({
  items,
  paused,
  running,
  onSteer,
  onEdit,
  onMove,
  onRemove,
  onResume,
  onClear,
}: QueuedMessagesProps) {
  if (items.length === 0) return null;
  return (
    <section
      aria-label="Queued messages"
      // Tucked under the composer: the negative margin puts the tray's bottom
      // edge behind the composer's rounded top, so the two read as one object.
      className="-mb-4 rounded-t-2xl border border-b-0 border-border/50 bg-muted/60 px-1.5 pt-1.5 pb-5"
    >
      <header className="flex items-center gap-2 px-2 pb-1 text-xs">
        <span className="font-medium text-foreground">Queued</span>
        <span className="rounded-full bg-background px-1.5 tabular-nums text-muted-foreground">
          {items.length}
        </span>
        <span role="status" className="min-w-0 truncate text-muted-foreground">
          {paused
            ? 'Paused. Nothing sends until you resume.'
            : running
              ? 'The first sends when this run finishes.'
              : 'Sending…'}
        </span>
        <span className="ml-auto flex shrink-0 items-center gap-1">
          {paused && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-2 text-xs"
              onClick={onResume}
            >
              <Play className="size-3" aria-hidden />
              Resume
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-muted-foreground"
            onClick={onClear}
          >
            Clear
          </Button>
        </span>
      </header>
      <ol className="flex max-h-[min(36vh,18rem)] flex-col gap-1 overflow-y-auto overscroll-contain">
        {items.map((item, index) => {
          const images = item.files.length;
          // A steer is text alone on the wire; an image would be dropped silently.
          const steerBlocked = !running
            ? 'Nothing is running to steer.'
            : images > 0
              ? 'A steer carries text only. This message waits for its own turn.'
              : !item.text.trim()
                ? 'Nothing to steer with.'
                : null;
          return (
            <li
              key={item.id}
              className={cn(
                'group flex items-start gap-2 rounded-xl bg-card px-2.5 py-1.5 text-sm',
                index === 0 && 'ring-1 ring-border',
              )}
            >
              <span className="mt-0.5 w-4 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                {index + 1}
              </span>
              <p className="line-clamp-2 min-w-0 flex-1 whitespace-pre-wrap break-words">
                {item.text.trim() || <span className="text-muted-foreground">(images only)</span>}
                {images > 0 && (
                  <span className="ml-2 inline-flex items-center gap-1 align-middle text-xs text-muted-foreground">
                    <ImageIcon className="size-3" aria-hidden />
                    {images}
                  </span>
                )}
              </p>
              <span className="flex shrink-0 items-center gap-0.5">
                <RowAction
                  label="Steer the run with this now"
                  hint={
                    steerBlocked ??
                    'Sends it into the run in flight. The harness cancels the run’s remaining tool calls when a steer lands.'
                  }
                  disabled={steerBlocked !== null}
                  onClick={() => onSteer(item.id)}
                >
                  <CornerDownRight />
                </RowAction>
                <RowAction label="Edit in the composer" onClick={() => onEdit(item.id)}>
                  <Pencil />
                </RowAction>
                <RowAction
                  label="Move up"
                  disabled={index === 0}
                  onClick={() => onMove(item.id, -1)}
                >
                  <ArrowUp />
                </RowAction>
                <RowAction
                  label="Move down"
                  disabled={index === items.length - 1}
                  onClick={() => onMove(item.id, 1)}
                >
                  <ArrowDown />
                </RowAction>
                <RowAction label="Remove from the queue" onClick={() => onRemove(item.id)}>
                  <X />
                </RowAction>
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function RowAction({
  label,
  hint,
  disabled,
  onClick,
  children,
}: {
  label: string;
  hint?: string;
  disabled?: boolean;
  onClick(): void;
  children: ReactNode;
}) {
  const button = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={label}
      // `aria-disabled`, not `disabled`: a disabled button takes no hover, so the
      // tooltip saying *why* it cannot be pressed would never open.
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      className={cn(
        'size-6 text-muted-foreground hover:text-foreground [&_svg]:size-3.5',
        disabled && 'opacity-40 hover:text-muted-foreground',
      )}
    >
      {children}
    </Button>
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>{button}</TooltipTrigger>
      <TooltipContent className="max-w-64">{hint ?? label}</TooltipContent>
    </Tooltip>
  );
}
