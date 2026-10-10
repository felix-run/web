import { Badge } from '@felix/ui/badge';
import { Button } from '@felix/ui/button';
import {
  Questionnaire,
  QuestionnaireChoice,
  QuestionnaireChoices,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireSubmit,
  QuestionnaireTitle,
} from '@felix/ui/questionnaire';
import { useCallback, useRef } from 'react';
import { DECISION_BUTTON } from '@/components/approval/approval-decision';
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
  //
  // A callback ref rather than a mount effect: the questionnaire replaces its field
  // once while the item registers, so an effect here focused an element that was
  // about to leave the page. Done only once focus has actually landed on a field in
  // the document — and then never again, so a later re-mount cannot pull it back.
  const focused = useRef(false);
  const inputRef = useCallback((el: HTMLInputElement | null) => {
    if (!el || focused.current || !el.isConnected) return;
    if (isTyping(document.activeElement)) {
      focused.current = true;
      return;
    }
    el.focus();
    if (document.activeElement === el) focused.current = true;
  }, []);

  const kindLabel =
    pending.kind === 'confirm' ? 'Confirm' : pending.kind === 'select' ? 'Select' : 'Input';

  return (
    // Same treatment as `ApprovalDecision`: both are the run stopping to wait for a
    // person, and they were rendering in two different colour vocabularies and two
    // different widths. `--state-blocked` and `max-w-3xl` are what the rest of the
    // column uses.
    <div className="mx-auto mb-3 w-full max-w-3xl px-4 md:px-6">
      {/* The approval card's container, statement and lift: a question blocks the run
          exactly as an approval does, so it owns the screen the same way. */}
      <div className="rounded-2xl border-2 border-state-blocked/50 bg-solid-state-blocked/5 p-5 shadow-approval">
        <Badge variant="secondary" className="py-0.5 text-sm font-semibold">
          {kindLabel}
        </Badge>
        <h2 className="mt-2 text-lg font-semibold tracking-tight text-balance">{pending.prompt}</h2>

        {pending.kind === 'confirm' ? (
          // Yes and No as Approve and Deny are: equal width, both outline, so the
          // styling never picks the answer. The decline is a third, quieter way out.
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              className={DECISION_BUTTON}
              disabled={resolving}
              onClick={() => onRespond(true)}
            >
              Yes
            </Button>
            <Button
              size="sm"
              variant="outline"
              className={DECISION_BUTTON}
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

        {pending.kind === 'select' || pending.kind === 'input' ? (
          // One question as a form: the choice (or the typed answer) is made, then
          // sent — never sent by the act of choosing, because a radio group moves
          // its selection on an arrow key and an answer the agent acts on must not
          // be one keystroke of navigation. Number keys pick an option, Enter sends.
          <Questionnaire
            className="mt-3 gap-3"
            shortcuts={pending.kind === 'select' ? 'numbers' : undefined}
            onSubmit={(e) => {
              e.preventDefault();
              const value = new FormData(e.currentTarget).get('answer');
              if (value === null) return;
              onRespond(String(value));
            }}
          >
            <QuestionnaireItem name="answer" required disabled={resolving}>
              <QuestionnaireTitle className="sr-only">{pending.prompt}</QuestionnaireTitle>
              {pending.kind === 'select' ? (
                <QuestionnaireChoices>
                  {pending.options.map((opt) => (
                    <QuestionnaireChoice
                      key={opt.value}
                      value={opt.value}
                      defaultChecked={pending.defaultValue === opt.value}
                    >
                      {opt.label}
                    </QuestionnaireChoice>
                  ))}
                </QuestionnaireChoices>
              ) : (
                <QuestionnaireInput
                  ref={inputRef}
                  aria-label={pending.prompt}
                  defaultValue={
                    typeof pending.defaultValue === 'string' ? pending.defaultValue : ''
                  }
                  placeholder="Type a response…"
                />
              )}
            </QuestionnaireItem>
            <div className="flex flex-wrap gap-2">
              <QuestionnaireSubmit size="sm" disabled={resolving}>
                Send answer
              </QuestionnaireSubmit>
              <Button
                size="sm"
                type="button"
                variant="ghost"
                disabled={resolving}
                onClick={onCancel}
              >
                {DECLINE_LABEL}
              </Button>
            </div>
          </Questionnaire>
        ) : null}
      </div>
    </div>
  );
}
