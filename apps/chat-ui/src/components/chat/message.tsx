import type { Turn } from '@/types';
import { MessageActions } from './message-actions';
import { Response } from './response';
import { Tool } from './tool';

/**
 * One transcript turn. User turns are right-aligned bubbles; assistant turns
 * are full-width prose with optional tool cards (ChatGPT / Claude style).
 */
export function Message({
  turn,
  streaming,
  onRegenerate,
  onRewind,
  verbose = false,
}: {
  turn: Turn;
  streaming?: boolean;
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
          <div className="max-w-[min(80%,36rem)] whitespace-pre-wrap rounded-2xl rounded-br-md bg-foreground px-4 py-2.5 text-sm leading-relaxed text-background">
            {turn.content}
          </div>
        )}
        <MessageActions content={turn.content} onRewind={onRewind} className="pr-0.5" />
      </div>
    );
  }

  const empty = !turn.content && !turn.tools?.length;
  const toolCount = turn.tools?.length ?? 0;
  return (
    <div className="group flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="flex size-6 items-center justify-center rounded-full bg-muted text-[10px] font-semibold tracking-wide text-muted-foreground"
          aria-hidden
        >
          F
        </span>
        <span className="text-xs font-medium text-muted-foreground">Felix</span>
        {streaming && !empty && (
          <span className="text-[10px] text-muted-foreground/80">streaming</span>
        )}
        {verbose && toolCount > 0 && (
          <span className="rounded-full bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
            {toolCount} tool{toolCount === 1 ? '' : 's'}
          </span>
        )}
      </div>

      {turn.tools && turn.tools.length > 0 && (
        <div className="flex flex-col gap-2">
          {turn.tools.map((tool, i) => (
            <Tool key={`${tool.name}-${i}`} tool={tool} verbose={verbose} />
          ))}
        </div>
      )}

      {turn.content && (
        <div className="max-w-none text-sm leading-relaxed text-foreground">
          <Response>{turn.content}</Response>
        </div>
      )}

      {turn.usage && (
        <div
          className="font-mono text-[10px] text-muted-foreground"
          title="Cumulative tokens for this turn"
        >
          {turn.usage.input.toLocaleString()} in · {turn.usage.output.toLocaleString()} out ·{' '}
          {(turn.usage.input + turn.usage.output).toLocaleString()} tok
        </div>
      )}

      {empty && streaming && <TypingIndicator />}

      {!streaming && !empty && (
        <MessageActions content={turn.content} onRegenerate={onRegenerate} onRewind={onRewind} />
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
