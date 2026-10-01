import { Button } from '@felix/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@felix/ui/tooltip';
import { ThumbsDownIcon, ThumbsUpIcon } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { TurnFeedback } from '@/types';

/** Where a thumbs-down goes when it is also saved as an eval case, unless renamed. */
export const DEFAULT_FEEDBACK_DATASET = 'chat-feedback';

/**
 * Rate an answer up or down.
 *
 * Up is one click and toggles. Down opens a short form first, because a bare
 * "bad" is the least useful thing an operator can be told: the note says what
 * was wrong, and with a note the answer's question can be saved as an eval case
 * judged against it — which is what turns a complaint into a regression test.
 * Without a note there is nothing to judge against, so the case option waits
 * for one.
 *
 * A rated turn keeps its control visible rather than hiding it behind hover with
 * the other actions, for the same reason a label does: a rating nobody can see
 * without hunting for it reads as one that did not save.
 */
export function RateTurn({
  feedback,
  onRate,
}: {
  feedback?: TurnFeedback;
  onRate: (rating: 'up' | 'down' | null, opts?: { note?: string; evalDataset?: string }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [asCase, setAsCase] = useState(false);
  const [dataset, setDataset] = useState(DEFAULT_FEEDBACK_DATASET);
  const rating = feedback?.rating;

  const submitDown = () => {
    const trimmed = note.trim();
    onRate('down', {
      ...(trimmed ? { note: trimmed } : {}),
      ...(trimmed && asCase && dataset.trim() ? { evalDataset: dataset.trim() } : {}),
    });
    setOpen(false);
  };

  if (open) {
    return (
      // Its own line: beside the action buttons — invisible until hover, still
      // taking their width — the form started indented under nothing.
      <div className="w-full">
        <form
          className="flex w-full max-w-md flex-col gap-2 rounded-lg border border-border bg-background p-2.5"
          onSubmit={(e) => {
            e.preventDefault();
            submitDown();
          }}
        >
          <label className="text-xs font-medium text-foreground" htmlFor="rate-note">
            What was wrong with this answer?
          </label>
          <textarea
            id="rate-note"
            // biome-ignore lint/a11y/noAutofocus: the form was just opened for this
            autoFocus
            value={note}
            maxLength={1000}
            rows={2}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
            }}
            placeholder="Optional, but it is what makes the rating useful"
            className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
          />
          <label
            className={cn(
              'flex flex-wrap items-center gap-2 text-xs',
              note.trim() ? 'text-foreground' : 'text-muted-foreground',
            )}
          >
            <input
              type="checkbox"
              checked={asCase && !!note.trim()}
              disabled={!note.trim()}
              onChange={(e) => setAsCase(e.target.checked)}
            />
            Also save as an eval case in
            <input
              aria-label="Eval dataset"
              value={dataset}
              disabled={!note.trim() || !asCase}
              onChange={(e) => setDataset(e.target.value)}
              className="h-6 w-36 rounded border border-border bg-background px-1.5 font-mono text-xs disabled:opacity-60"
            />
          </label>
          <div className="flex items-center gap-2">
            <Button type="submit" size="sm">
              Mark down
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      </div>
    );
  }

  const button = (which: 'up' | 'down') => {
    const pressed = rating === which;
    const Icon = which === 'up' ? ThumbsUpIcon : ThumbsDownIcon;
    const verb = which === 'up' ? 'Good answer' : 'Bad answer';
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-pressed={pressed}
            aria-label={pressed ? `${verb} (click to clear)` : verb}
            className={cn(
              'size-7 dark:hover:bg-solid-accent/50',
              pressed ? 'text-foreground' : 'text-muted-foreground',
            )}
            onClick={() => {
              if (pressed) onRate(null);
              else if (which === 'up') onRate('up');
              else {
                setNote(feedback?.note ?? '');
                setOpen(true);
              }
            }}
          >
            <Icon className="size-3.5" fill={pressed ? 'currentColor' : 'none'} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{pressed ? 'Clear rating' : verb}</TooltipContent>
      </Tooltip>
    );
  };

  return (
    <div
      className={cn(
        'flex items-center gap-0.5',
        rating
          ? ''
          : 'opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100',
      )}
    >
      {button('up')}
      {button('down')}
      {rating === 'down' && feedback?.note && (
        <span className="ml-1 min-w-0 truncate text-xs text-muted-foreground" title={feedback.note}>
          “{feedback.note}”
        </span>
      )}
    </div>
  );
}
