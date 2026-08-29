import { interleaveTurn } from '@felix/client';
import type { Turn } from '@/types';
import { MessageActions } from './message-actions';
import { Reasoning } from './reasoning';
import { Response } from './response';
import { Tool } from './tool';

/**
 * One transcript turn. User turns are right-aligned bubbles; assistant turns
 * are full-width prose with optional tool cards (ChatGPT / Claude style).
 *
 * The assistant's prose and its tool cards are interleaved, not stacked: see
 * `interleaveTurn`. A turn is a sequence of saying and doing, and rendering
 * every card above one merged paragraph claimed an order the agent never had.
 */
export function Message({
  turn,
  streaming,
  label,
  onLabel,
  onRegenerate,
  onRewind,
  verbose = false,
}: {
  turn: Turn;
  streaming?: boolean;
  /** The operator's name for this turn, from the session snapshot. */
  label?: string;
  /** Set or clear it. Absent until the turn has a server event id. */
  onLabel?: (label: string | null) => void;
  /** Provided only for the last assistant turn (enables Regenerate). */
  onRegenerate?: () => void;
  /** Rewind the server leaf to this turn's event id. */
  onRewind?: () => void;
  /** Expand tool I/O and surface tool counts when set. */
  verbose?: boolean;
}) {
  if (turn.role === 'user') {
    return (
      <div className="group flex w-full flex-col items-end gap-1.5">
        {/* Outside the actions row on purpose: that row is hidden until hover,
            and a label nobody can see without hunting for it is not a label. */}
        {label && <LabelChip label={label} />}
        {turn.attachments && turn.attachments.length > 0 && (
          <div className="flex max-w-[min(80%,28rem)] flex-wrap justify-end gap-2">
            {turn.attachments.map((a) => (
              <img
                key={a.url}
                src={a.url}
                alt={a.filename ?? 'attachment'}
                className="size-24 rounded-xl border border-border/50 object-cover"
              />
            ))}
          </div>
        )}
        {turn.content && (
          <div className="max-w-[min(80%,36rem)] whitespace-pre-wrap rounded-2xl rounded-br-md bg-foreground px-4 py-2.5 text-base text-background">
            {turn.content}
          </div>
        )}
        <MessageActions
          content={turn.content}
          onRewind={onRewind}
          {...(label === undefined ? {} : { label })}
          {...(onLabel ? { onLabel } : {})}
          className="pr-0.5"
        />
      </div>
    );
  }

  const empty = !turn.content && !turn.tools?.length;
  const toolCount = turn.tools?.length ?? 0;
  return (
    <div className="group flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="flex size-6 items-center justify-center rounded-full bg-muted text-xs font-semibold tracking-wide text-muted-foreground"
          aria-hidden
        >
          F
        </span>
        <span className="text-xs font-medium text-muted-foreground">Felix</span>
        {streaming && !empty && <span className="text-xs text-muted-foreground/80">streaming</span>}
        {verbose && toolCount > 0 && (
          <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
            {toolCount} tool{toolCount === 1 ? '' : 's'}
          </span>
        )}
        {label && <LabelChip label={label} />}
      </div>

      {/* Keyed by position: segments are append-only while a turn streams — a card
          opens at the end of the prose so far, so nothing already rendered shifts. */}
      {interleaveTurn(turn.content, turn.tools, turn.reasoning).map((segment, i, arr) => {
        if (segment.kind === 'tool') {
          return <Tool key={`segment-${i}`} tool={segment.tool} verbose={verbose} />;
        }
        if (segment.kind === 'reasoning') {
          // Only the final block is still being written, and only while the turn is.
          const last = i === arr.length - 1;
          return (
            <Reasoning key={`segment-${i}`} text={segment.text} streaming={streaming && last} />
          );
        }
        return (
          <div key={`segment-${i}`} className="max-w-none text-base text-foreground">
            <Response>{segment.text}</Response>
          </div>
        );
      })}

      {turn.usage && (
        <div
          className="font-mono text-xs text-muted-foreground"
          title="Cumulative tokens for this turn"
        >
          {turn.usage.input.toLocaleString()} in · {turn.usage.output.toLocaleString()} out ·{' '}
          {(turn.usage.input + turn.usage.output).toLocaleString()} tok
        </div>
      )}

      {empty && streaming && <TypingIndicator />}

      {!streaming && !empty && (
        <MessageActions
          content={turn.content}
          onRegenerate={onRegenerate}
          onRewind={onRewind}
          {...(label === undefined ? {} : { label })}
          {...(onLabel ? { onLabel } : {})}
        />
      )}
    </div>
  );
}

function TypingIndicator() {
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-1.5 py-1 text-muted-foreground"
      aria-label="Felix is typing"
    >
      <span className="size-1.5 animate-pulse rounded-full bg-current opacity-40 [animation-delay:0ms]" />
      <span className="size-1.5 animate-pulse rounded-full bg-current opacity-70 [animation-delay:150ms]" />
      <span className="size-1.5 animate-pulse rounded-full bg-current [animation-delay:300ms]" />
    </div>
  );
}

/**
 * An operator's name for a turn.
 *
 * Rendered where it stays visible rather than inside the hover-revealed actions
 * row: the point of labelling "the turn where it went wrong" is to find it again
 * by scrolling, which a chip that only appears under the cursor cannot do.
 */
function LabelChip({ label }: { label: string }) {
  return (
    <span className="rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">
      {label}
    </span>
  );
}
