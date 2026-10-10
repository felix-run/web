import { promptTokens } from '@felix/protocol';
import { toast } from 'sonner';
import { middleTruncate } from '@/lib/format';
import type { Turn } from '@/types';

const nf = new Intl.NumberFormat();

/**
 * A turn's plumbing, under it, in debug mode: its server event ids and what the
 * client holds of its spend. One quiet mono line, never a card — it annotates
 * the turn, it is not a second thing to read.
 *
 * Only what the turn carries. `usage` is the final model call's block, which the
 * client keeps only for a turn that ran no tools; for one that did, the line says
 * the figure was not kept rather than drawing a smaller number as the turn's
 * spend. The Debug tab lists every call the harness metered for the thread.
 * `in` is the whole prompt, and the cache's share of it is shown, not hidden in
 * a title — in debug the split is the point.
 */
export function TurnDebugLine({ turn }: { turn: Turn }) {
  const parts: React.ReactNode[] = [];
  if (turn.eventId) parts.push(<DebugId key="event" label="event" value={turn.eventId} />);
  else parts.push(<span key="event">event not yet assigned</span>);
  if (turn.parentEventId) {
    parts.push(<DebugId key="parent" label="parent" value={turn.parentEventId} />);
  }
  if (turn.role === 'assistant') {
    const u = turn.usage;
    if (u) {
      const read = u.cacheRead ?? 0;
      const write = u.cacheWrite ?? 0;
      parts.push(
        <span key="tokens">
          {nf.format(promptTokens(u))} in
          {read || write
            ? ` (${nf.format(u.input)} new · ${nf.format(read)} cache read · ${nf.format(write)} cache write)`
            : ''}
          {' · '}
          {nf.format(u.output)} out
        </span>,
      );
    } else if (turn.tools?.length) {
      parts.push(<span key="tokens">per-call tokens in the Debug tab</span>);
    } else if (turn.content) {
      parts.push(<span key="tokens">no usage sent</span>);
    }
    if (turn.contextTokens !== undefined) {
      parts.push(<span key="ctx">{nf.format(turn.contextTokens)} in context</span>);
    }
  }
  return (
    <div
      data-slot="turn-debug"
      className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-xs text-muted-foreground"
    >
      {parts.map((part, i) => (
        // Positional: the parts are a fixed sequence for a given turn.
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 && <span aria-hidden>·</span>}
          {part}
        </span>
      ))}
    </div>
  );
}

/**
 * An id that copies itself. Cut from the middle, since ids differ at the end; the
 * whole value is in the title, the accessible name and the clipboard.
 */
export function DebugId({
  label,
  value,
  keep = 18,
  bare = false,
}: {
  label: string;
  value: string;
  keep?: number;
  /** Drop the visible label where a row already names it; it stays in the accessible name. */
  bare?: boolean;
}) {
  return (
    <button
      type="button"
      title={`${value} — click to copy`}
      aria-label={`Copy ${label} ${value}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(
          () => toast.success(`Copied ${label}`),
          () => toast.error(`Could not copy the ${label}`),
        );
      }}
      className="cursor-pointer rounded-sm font-mono underline decoration-border underline-offset-2 hover:text-foreground hover:decoration-current focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {bare ? '' : `${label} `}
      {middleTruncate(value, keep)}
    </button>
  );
}
