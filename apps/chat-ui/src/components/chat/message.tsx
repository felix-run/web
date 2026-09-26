import { interleaveTurn } from '@felix/client';
import type { Turn } from '@/types';
import { MessageActions } from './message-actions';
import { Reasoning } from './reasoning';
import { Response } from './response';
import { Tool } from './tool';

/**
 * One transcript turn. Both sides are labelled, left-aligned and full-width;
 * the operator's turn is set off by a rule rather than an inverted bubble.
 *
 * The bubble and the avatar were consumer-chat furniture: a solid near-black
 * block was the heaviest thing in the column, so the eye landed on what the
 * operator had typed instead of on what the agent did about it. A label and a
 * rule keep the two sides apart without colour — the word says whose turn it is,
 * and the rule says it where the word is out of view.
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
  if (turn.role === 'note') {
    // Neither side of the conversation, so neither bubble. Whether the model read
    // it is said in words rather than by styling alone, because an entry that is
    // steering the run and one nobody but an operator will see look the same
    // otherwise, and only one of them explains what the model did next.
    const inContext = turn.note?.inContext ?? false;
    return (
      <div className="group flex w-full flex-col gap-1.5">
        <div className="border-l-2 border-border py-1 pl-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="font-medium">Note · {turn.note?.role ?? 'system'}</span>
            <span>{inContext ? 'in the model’s context' : 'not sent to the model'}</span>
            {label && <LabelChip label={label} />}
          </div>
          {turn.content && (
            <div className="mt-1 whitespace-pre-wrap wrap-anywhere text-sm text-foreground">
              {turn.content}
            </div>
          )}
        </div>
        <MessageActions
          content={turn.content}
          onRewind={onRewind}
          {...(label === undefined ? {} : { label })}
          {...(onLabel ? { onLabel } : {})}
        />
      </div>
    );
  }

  if (turn.role === 'user') {
    return (
      <div className="group flex w-full flex-col gap-1.5">
        <div className="border-l-2 border-foreground/25 py-0.5 pl-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-medium text-muted-foreground">You</span>
            {/* Outside the actions row on purpose: that row is hidden until hover,
                and a label nobody can see without hunting for it is not a label. */}
            {label && <LabelChip label={label} />}
          </div>
          {turn.attachments && turn.attachments.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-2">
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
          {/* `wrap-anywhere`, not `break-words`: a commit hash, a path or a URL has no
              space to wrap at, and unwrapped it overflowed the turn and gave the
              whole transcript a sideways scroll at phone width (690px of content in
              a 368px column). Plain text has no table or code block that would want
              its words kept whole, so the stronger rule costs nothing here. */}
          {turn.content && (
            <div className="mt-1 whitespace-pre-wrap wrap-anywhere text-base text-foreground">
              {turn.content}
            </div>
          )}
        </div>
        <MessageActions
          content={turn.content}
          onRewind={onRewind}
          {...(label === undefined ? {} : { label })}
          {...(onLabel ? { onLabel } : {})}
        />
      </div>
    );
  }

  const empty = !turn.content && !turn.tools?.length;
  const toolCount = turn.tools?.length ?? 0;
  return (
    <div className="group flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Felix</span>
        {streaming && !empty && <span className="text-xs text-muted-foreground">streaming</span>}
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

      {turn.stop && (
        <div
          className="font-mono text-xs text-state-blocked"
          title="The react loop hit spec.recursion_limit before the model finished; the answer above is cut short"
        >
          Stopped at the step limit
          {turn.stop.limit === undefined ? '' : ` (${turn.stop.limit})`} with tool calls still
          pending
        </div>
      )}

      {turn.usage && (
        <div
          className="font-mono text-xs text-muted-foreground"
          title="Cumulative tokens for this turn"
        >
          {turn.usage.input.toLocaleString()} in · {turn.usage.output.toLocaleString()} out ·{' '}
          {(turn.usage.input + turn.usage.output).toLocaleString()} tok
        </div>
      )}

      {/* A turn carrying reasoning already says "Thinking" in its own block. */}
      {empty && streaming && !turn.reasoning?.length && <AwaitingStatus />}

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

/**
 * A sent turn that nothing has come back for yet.
 *
 * Three pulsing dots claimed the agent was typing, which is the one thing it is
 * provably not doing — no delta has arrived. What is true is that the request
 * is out and the harness has not answered, so that is what it says, in a word
 * that does not move: motion here would compete with the stream it is waiting
 * for, and a static word honours reduced motion without needing a query.
 */
function AwaitingStatus() {
  return (
    <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
      Waiting for the harness…
    </p>
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
    <span className="min-w-0 wrap-anywhere rounded-full bg-accent px-2 py-0.5 text-xs text-accent-foreground">
      {label}
    </span>
  );
}
