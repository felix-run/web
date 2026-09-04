import { formatCountdown, msUntilDecision, summarizeToolArgs } from '@felix/client';
import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { toastError } from '@/lib/error-toast';
import { cn } from '@/lib/utils';

/** Lines shown before a payload folds. Chosen to clear a typical shell or write call whole. */
const FOLD_LINES = 14;
/**
 * Characters shown before a payload folds, regardless of line count.
 *
 * A line budget alone is not enough: `JSON.stringify` escapes real newlines, so a
 * thirty-line file body arrives as one logical line and slips straight past a
 * line-count fold. Measured before this existed, a 3065-character payload rendered
 * an 1850px-tall pane and pushed the decision buttons off the bottom of the rail.
 */
const FOLD_CHARS = 700;

export interface ApprovalDecisionProps {
  /** Tool the harness is holding, e.g. `write_file`. */
  toolName: string;
  /** Arguments it would be called with. */
  args: Record<string, unknown>;
  /**
   * Prior file content when the tool writes a file: `null` means the file does not
   * exist yet, `undefined` means this is not a write and there is no before/after
   * to show.
   */
  before?: string | null;
  /** Manifest that asked, shown quietly beside the tool name. */
  context?: string;
  /** How many approvals are waiting in total, when more than one. */
  queueLength?: number;
  /**
   * The run this belongs to has been aborted. The approval record outlives the run
   * (the harness's `request_abort` cancels queued tools and marks the queue aborted,
   * but never touches approvals), so this stays answerable; it just will not restart
   * anything, and saying otherwise would be a false promise.
   */
  runAborted?: boolean;
  /**
   * Epoch ms after which the harness answers for you.
   *
   * **Not answering is answering.** `wait_for_decision` is called with the
   * rule's `ttl_seconds` — five minutes when it sets none — and on timeout
   * returns `denied` with the note `timeout`: the tool is refused and the run
   * moves on. Buttons still offered past that point ask about a decision
   * already made. Omitted while unknown, which is the state an approval
   * announced by frame is in until the `/approvals` poll fills it in.
   */
  expiresAt?: number | null;
  /**
   * Perform the decision. Should throw on failure; this component owns the
   * in-flight guard and both toasts so every caller gets the same behaviour.
   */
  onDecide: (status: 'approved' | 'denied') => Promise<void>;
  className?: string;
}

/**
 * The one place a gated tool call is approved or denied.
 *
 * There were two of these: a banner under the transcript and a section in the
 * inspector, agreeing on neither copy, colour, payload treatment, nor guards. The
 * same decision looked like two different features depending on where it was
 * noticed, and the more prominent of the two was the weaker.
 *
 * Three things this arrangement is deliberate about, because the previous banner
 * got each of them backwards:
 *
 * 1. **Evidence before decision.** The buttons sit below the payload, not above and
 *    to the right of it. Approving a file write without having seen the file should
 *    take deliberate scrolling past it, not be the natural reading order.
 * 2. **Nothing is hidden sideways.** The old After pane was `white-space: pre` in a
 *    313px box, so a measured 52% of the content being approved sat off-screen
 *    behind a horizontal scrollbar. Payloads wrap, and when they are genuinely long
 *    they fold with a control that says how much is hidden.
 * 3. **Deny is not subordinate.** Approve was a solid fill and Deny a near-invisible
 *    ghost, which is the wrong emphasis for the irreversible half of a pair. They
 *    carry equal visual weight and Approve names its target.
 */
export function ApprovalDecision({
  toolName,
  args,
  before,
  context,
  expiresAt,
  queueLength,
  runAborted,
  onDecide,
  className,
}: ApprovalDecisionProps) {
  // A ref, not the state below: React batches, so a burst of clicks in one tick
  // would all read the same pre-update value and every one would post.
  const inFlight = useRef(false);
  const [deciding, setDeciding] = useState<'approved' | 'denied' | null>(null);

  const isWrite = before !== undefined;
  const summary = oneLine(summarizeToolArgs(toolName, args));

  // Re-read every second while the card is up, and only then. The deadline is
  // minutes long, so this is a handful of renders per approval.
  const [left, setLeft] = useState(() => msUntilDecision({ expiresAt }));
  useEffect(() => {
    setLeft(msUntilDecision({ expiresAt }));
    if (expiresAt == null) return;
    const timer = setInterval(() => setLeft(msUntilDecision({ expiresAt })), 1_000);
    return () => clearInterval(timer);
  }, [expiresAt]);
  const lapsed = left === 0;

  async function decide(status: 'approved' | 'denied') {
    if (inFlight.current) return;
    inFlight.current = true;
    setDeciding(status);
    try {
      await onDecide(status);
      toast.success(
        status === 'approved' ? `Approved ${toolName}. The run continues.` : `Denied ${toolName}.`,
      );
    } catch (err) {
      // No retry: a decision that failed with 409 is one the harness already has,
      // and re-posting the other outcome is not something a button should offer.
      toastError(err, `${status === 'approved' ? 'approve' : 'deny'} ${toolName}`);
    } finally {
      inFlight.current = false;
      setDeciding(null);
    }
  }

  return (
    <div
      className={cn('rounded-xl border border-state-blocked/40 bg-state-blocked/5 p-3', className)}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="py-0 font-mono text-xs">
          {toolName}
        </Badge>
        {context && <span className="truncate text-xs text-muted-foreground">{context}</span>}
        {queueLength && queueLength > 1 ? (
          <span className="ml-auto text-xs text-muted-foreground">
            {queueLength - 1} more waiting
          </span>
        ) : null}
      </div>

      {summary && <p className="mt-1.5 text-sm">{summary}</p>}

      {isWrite ? (
        <div className="mt-2.5 space-y-2">
          {/*
            Stacked, not side by side. The previous version used `md:grid-cols-2`,
            a *viewport* breakpoint on a card that is 672px at most and ~300px in
            the rail, so it always split into two columns too narrow for code and
            pushed the content sideways.
          */}
          <CodePane label={before === null ? 'Before (file does not exist yet)' : 'Before'}>
            {before === null ? '(empty)' : (before ?? '')}
          </CodePane>
          <CodePane label="After" emphasis>
            {typeof args.content === 'string' ? args.content : ''}
          </CodePane>
        </div>
      ) : (
        <div className="mt-2.5">
          <CodePane label="Arguments" emphasis>
            {safeStringify(args)}
          </CodePane>
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          className="h-8 flex-1"
          disabled={deciding !== null || lapsed}
          onClick={() => void decide('approved')}
        >
          {deciding === 'approved' ? 'Approving…' : `Approve ${toolName}`}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="h-8 flex-1"
          disabled={deciding !== null || lapsed}
          onClick={() => void decide('denied')}
        >
          {deciding === 'denied' ? 'Denying…' : 'Deny'}
        </Button>
      </div>

      <p className="mt-2 text-xs leading-snug text-muted-foreground">
        {lapsed ? (
          <span className="text-state-failed">
            The harness stopped waiting and denied this itself.
          </span>
        ) : runAborted ? (
          'This run was stopped, so deciding will not restart it. Answering still closes out the request.'
        ) : (
          <>
            Deciding resumes the paused run, no need to re-send.
            {left !== null && (
              <>
                {' '}
                Denied automatically in {formatCountdown(left)}; approving also allows this exact
                call until then.
              </>
            )}
          </>
        )}
      </p>
    </div>
  );
}

/** A payload block: wraps rather than scrolling sideways, and folds rather than clipping. */
function CodePane({
  label,
  children,
  emphasis,
}: {
  label: string;
  children: string;
  emphasis?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const lines = children.split('\n');
  const tooManyLines = lines.length > FOLD_LINES;
  const tooLong = children.length > FOLD_CHARS;
  const overlong = tooManyLines || tooLong;
  const folded = tooManyLines
    ? lines.slice(0, FOLD_LINES).join('\n').slice(0, FOLD_CHARS)
    : children.slice(0, FOLD_CHARS);
  const shown = expanded || !overlong ? children : folded;

  return (
    <div>
      <div className="mb-1 text-xs text-muted-foreground">{label}</div>
      <pre
        className={cn(
          'overflow-x-auto rounded-md border border-border/40 bg-background p-2 font-mono text-sm whitespace-pre-wrap break-words',
          emphasis ? 'text-foreground/90' : 'text-muted-foreground',
          expanded && 'max-h-64 overflow-y-auto',
        )}
      >
        {shown || '(empty)'}
      </pre>
      {overlong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 rounded text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {expanded
            ? 'Show less'
            : tooManyLines
              ? `Show all ${lines.length} lines (${lines.length - FOLD_LINES} hidden)`
              : `Show all ${children.length.toLocaleString()} characters (${(children.length - folded.length).toLocaleString()} hidden)`}
        </button>
      )}
    </div>
  );
}

/** `summarizeToolArgs` falls back to pretty JSON for unknown tools; that is not a summary. */
function oneLine(text: string): string {
  if (text.includes('\n') || text.length > 140) return '';
  return text;
}

/** Payloads come off the wire; a cycle or a BigInt should not take the panel down. */
function safeStringify(value: unknown): string {
  try {
    return (
      JSON.stringify(value, (_k, v) => (typeof v === 'bigint' ? String(v) : v), 2) ?? String(value)
    );
  } catch {
    return String(value);
  }
}
