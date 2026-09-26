import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import { useEffect, useRef } from 'react';
import type { PendingUiRequest } from '@/types';

/**
 * The third answer, and it is not "No".
 *
 * `No` posts `value: false` — an answer the agent acts on. This one posts
 * `cancelled: true`, which is what the harness hands the agent when the prompt
 * times out: the question went unanswered. Both were drawn side by side as
 * "No" and "Cancel", which a reader cannot tell apart and the agent can.
 */
const DECLINE_LABEL = 'Decline to answer';

/** True when the user is mid-sentence somewhere, and moving focus would eat the next keystroke. */
function isTyping(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  return (
    el.isContentEditable ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'submit'].includes(el.type))
  );
}

export function UiPromptBanner({
  pending,
  resolving,
  onRespond,
  onCancel,
}: {
  pending: PendingUiRequest;
  resolving: boolean;
  onRespond: (value: unknown) => void;
  onCancel: () => void;
}) {
  // Replaces `autoFocus`, which fired whenever the prompt arrived — including
  // while someone was typing into the composer, where it took the rest of their
  // sentence into this field instead. Focus moves only when nothing is being
  // typed; otherwise the field is the next Tab stop above the composer.
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!isTyping(document.activeElement)) inputRef.current?.focus();
  }, []);

  const kindLabel =
    pending.kind === 'confirm' ? 'Confirm' : pending.kind === 'select' ? 'Select' : 'Input';

  return (
    // Same treatment as `ApprovalDecision`: both are the run stopping to wait for a
    // person, and they were rendering in two different colour vocabularies and two
    // different widths. `--state-blocked` and `max-w-3xl` are what the rest of the
    // column uses.
    <div className="mx-auto mb-3 w-full max-w-3xl px-4 md:px-6">
      <div className="rounded-xl border border-state-blocked/40 bg-state-blocked/5 p-3">
        <Badge variant="secondary" className="py-0 text-xs">
          {kindLabel}
        </Badge>
        <h2 className="mt-1.5 text-sm font-semibold">{pending.prompt}</h2>

        {pending.kind === 'confirm' ? (
          <div className="mt-3 flex flex-wrap gap-2">
            <Button size="sm" disabled={resolving} onClick={() => onRespond(true)}>
              Yes
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={resolving}
              onClick={() => onRespond(false)}
            >
              No
            </Button>
            <Button size="sm" variant="ghost" disabled={resolving} onClick={onCancel}>
              {DECLINE_LABEL}
            </Button>
          </div>
        ) : null}

        {pending.kind === 'select' ? (
          <div className="mt-3 flex flex-wrap gap-2">
            {pending.options.map((opt) => (
              <Button
                key={opt.value}
                size="sm"
                variant="outline"
                disabled={resolving}
                onClick={() => onRespond(opt.value)}
              >
                {opt.label}
              </Button>
            ))}
            <Button size="sm" variant="ghost" disabled={resolving} onClick={onCancel}>
              {DECLINE_LABEL}
            </Button>
          </div>
        ) : null}

        {pending.kind === 'input' ? (
          <form
            className="mt-3 flex flex-wrap gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              onRespond(String(fd.get('value') ?? ''));
            }}
          >
            <input
              name="value"
              defaultValue={typeof pending.defaultValue === 'string' ? pending.defaultValue : ''}
              disabled={resolving}
              ref={inputRef}
              aria-label={pending.prompt}
              className="min-w-[12rem] flex-1 rounded-lg border border-border bg-background px-3 py-1.5 text-sm"
              placeholder="Type a response…"
            />
            <Button size="sm" type="submit" disabled={resolving}>
              Send
            </Button>
            <Button size="sm" type="button" variant="ghost" disabled={resolving} onClick={onCancel}>
              {DECLINE_LABEL}
            </Button>
          </form>
        ) : null}
      </div>
    </div>
  );
}
