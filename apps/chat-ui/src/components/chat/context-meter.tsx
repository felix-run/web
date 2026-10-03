import { promptTokens, type TokenUsage } from '@felix/protocol';
import {
  Context,
  ContextCacheUsage,
  ContextContent,
  ContextContentBody,
  ContextContentHeader,
  ContextInputUsage,
  ContextOutputUsage,
  ContextTrigger,
} from '@/components/ai-elements/context';
import { cn } from '@/lib/utils';

type ContextUsage = NonNullable<React.ComponentProps<typeof Context>['usage']>;

import type { Turn } from '@/types';

/** At or above this share the meter says so in words, not only with the bar. */
export const NEARLY_FULL = 0.9;

/**
 * How full the context window was after the newest reply, or `null` when that
 * cannot be said.
 *
 * Reads the last assistant turn that reported one — the final model call's prompt
 * plus its reply, which is the whole active branch as the model last saw it. A
 * newer turn without a figure (a durable run not yet re-read, a provider that
 * reports nothing) falls back to the one before it rather than to nothing, which
 * understates by one exchange at most and says "as of" so the reader knows.
 */
export function contextFill(turns: Turn[], window: number | undefined) {
  if (!window || window <= 0) return null;
  for (let i = turns.length - 1; i >= 0; i--) {
    const used = turns[i]?.contextTokens;
    if (turns[i]?.role === 'assistant' && used !== undefined) {
      // The same turn's spend, for the breakdown: absent when the turn ran tools,
      // since then the final call is one step of it (`Turn.usage`).
      const usage = turns[i]?.usage;
      return { used, window, share: used / window, ...(usage ? { usage } : {}) };
    }
  }
  return null;
}

const compact = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 100_000 ? 0 : 1).replace(/\.0$/, '')}k` : `${n}`;

/**
 * The context window, as a fact about the next send: it sits beside the agent and
 * Thinking pickers because the window is the selected agent's, and the history it
 * measures is what the next message is appended to.
 *
 * Neutral on purpose. The state ramp's hues each mean one thing about a run —
 * amber is "waiting on a person" — and a filling window is none of them, so
 * nearly full is said in words rather than borrowed from a colour that already
 * means something else.
 */
export function ContextMeter({
  used,
  window,
  agent,
  usage,
}: {
  used: number;
  window: number;
  agent?: string;
  /** The last reply's tokens, for the breakdown on hover or focus. */
  usage?: TokenUsage;
}) {
  const share = Math.min(1, used / window);
  const pct = Math.round(share * 100);
  const full = share >= NEARLY_FULL;
  const detail = `${used.toLocaleString()} of ${window.toLocaleString()} tokens in ${
    agent ? `${agent}'s` : 'the'
  } context window, as of the last reply${
    full ? '. Nearly full: the harness compacts or the model truncates past this.' : '.'
  }`;
  const meter = (
    <div
      role="meter"
      aria-label="Context window used"
      aria-valuemin={0}
      aria-valuemax={window}
      aria-valuenow={Math.min(used, window)}
      aria-valuetext={`${pct}% — ${detail}`}
      // Focusable, so the breakdown opens from the keyboard as well as on hover.
      tabIndex={0}
      title={detail}
      // Below `sm` it yields to the agent picker, whose name it otherwise squeezed
      // to a bare chevron at 390px — which agent the next message goes to matters
      // more than how full its window is. Nearly full is the exception: that is
      // the one reading worth the agent's name truncating for.
      className={cn(
        'shrink-0 items-center gap-1.5 px-1 text-xs text-muted-foreground',
        full ? 'flex' : 'hidden sm:flex',
      )}
    >
      <span className="hidden h-1 w-8 overflow-hidden rounded-full bg-muted sm:block" aria-hidden>
        <span
          className={full ? 'block h-full bg-foreground' : 'block h-full bg-muted-foreground/70'}
          style={{ width: `${Math.max(pct, used > 0 ? 3 : 0)}%` }}
        />
      </span>
      <span className={full ? 'tabular-nums text-foreground' : 'tabular-nums'}>
        {pct}%
        <span className="hidden sm:inline">
          {' '}
          of {compact(window)}
          {full ? ' · nearly full' : ''}
        </span>
      </span>
    </div>
  );
  // AI Elements' Context hover card, for what the percentage is made of. No cost
  // line: its footer prices tokens from a third-party catalog, and the harness
  // prices them with its own — the Ledger's figure, where an unpriced model reads
  // `$0`. Two prices for one call would be worse than one.
  return (
    <Context usedTokens={Math.min(used, window)} maxTokens={window} usage={sdkUsage(usage)}>
      <ContextTrigger>{meter}</ContextTrigger>
      <ContextContent align="end" className="w-64">
        <ContextContentHeader />
        <ContextContentBody className="space-y-1.5 text-xs">
          {usage ? (
            <>
              <ContextInputUsage />
              <ContextCacheUsage />
              <ContextOutputUsage />
            </>
          ) : (
            <p className="text-muted-foreground">
              The last reply ran tools, so no single call's spend stands for it. The window figure
              is its final call's prompt.
            </p>
          )}
        </ContextContentBody>
      </ContextContent>
    </Context>
  );
}

/**
 * Felix's usage in the AI SDK's spelling, which the vendored rows read. `input`
 * here is the *uncached* prompt only, so the SDK's input — the whole prompt — is
 * `promptTokens`, with the cached part beside it.
 */
function sdkUsage(usage: TokenUsage | undefined) {
  if (!usage) return undefined;
  const input = promptTokens(usage);
  return {
    inputTokens: input,
    outputTokens: usage.output,
    totalTokens: input + usage.output,
    cachedInputTokens: usage.cacheRead ?? 0,
  } as unknown as ContextUsage;
}
