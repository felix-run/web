import { isSkillLibraryError } from '@felix/client';
import { Button } from '@felix/ui/button';
import { Textarea } from '@felix/ui/textarea';
import { useEffect, useId, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DECISION_BUTTON } from '@/components/approval/approval-decision';
import { ConfirmButton } from '@/components/confirm-button';
import { cn } from '@/lib/utils';
import { type MakeLive, useFreshSkill, useVersionActions } from './queries';
import { isForbidden, RefusalNotice } from './refusal';

/**
 * The place each answer takes in the decision row — Publish's in a wrapper it
 * needs anyway (it arms in place), Reject's in one of the same so the two are the
 * same kind of flex item. A bare button beside a wrapper is not: `flex-1`
 * resolves to a zero basis plus the item's own padding and border, so the bare
 * one came out 26px wider. Nothing here sizes the button itself — that is
 * `DECISION_BUTTON`, on each button — so both answers are one height and one width.
 */
const DECISION_SLOT = 'min-w-0 flex-1';

/**
 * The three decisions a version takes — publish, roll back, reject — as one
 * control set, shared by the Versions tab, the review queue and the chat card,
 * so a decision reads the same wherever it is made.
 *
 * Each arms before it fires and its question names the resolved consequence:
 * *which* version goes live and which it replaces. That is what catches
 * deciding the wrong row. A move to live re-reads the skill before it arms, so
 * the version it names as replaced is the one live *now*, and sends that
 * version as `expected_live_version`: if another one went live in between, the
 * harness refuses (`live_changed`) and the control re-asks naming the new one.
 * It never retries by itself. Publish and Reject are the same
 * weight, as Approve and Deny are on an approval card: nothing but the words
 * tells them apart.
 *
 * Reject needs a note — the harness requires one, and it is what the agent
 * that drafted the version will be told — so it opens a field first rather
 * than arming on a blank.
 */
export function VersionDecision({
  name,
  version,
  liveVersion,
  parentVersion,
  canPublish = true,
  canReject = true,
  onDecided,
  onForbidden,
  verb = 'Publish',
  className,
}: {
  name: string;
  version: string;
  liveVersion: string | null;
  /** The version this draft was edited from, to say so when it is not the live one. */
  parentVersion?: string | null;
  canPublish?: boolean;
  canReject?: boolean;
  onDecided?: (what: 'published' | 'rejected') => void;
  /** A 403: the key lacks `skills:write`. The host can drop the buttons for good. */
  onForbidden?: () => void;
  /** The publish button's verb — `Approve` on the chat card, where it answers a proposal. */
  verb?: string;
  className?: string;
}) {
  const { publish, reject } = useVersionActions();
  const failure = publish.error ?? reject.error;
  useEffect(() => {
    if (failure && isForbidden(failure)) onForbidden?.();
  }, [failure, onForbidden]);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const noteId = useId();
  const busy = publish.isPending || reject.isPending;

  // Publishing replaces whatever is live, not whatever the draft was edited
  // from. When those differ, a reviewer reading "edited from X" would think the
  // live version's own changes survive; they do not.
  const offParent = !!liveVersion && parentVersion !== undefined && parentVersion !== liveVersion;
  return (
    <div className={cn('space-y-2', className)}>
      {offParent && (
        <p role="note" className="text-xs text-state-blocked">
          {parentVersion ? (
            <>
              Edited from <span className="font-mono">{parentVersion}</span>, not from the live{' '}
              <span className="font-mono">{liveVersion}</span>.
            </>
          ) : (
            <>
              Not edited from the live <span className="font-mono">{liveVersion}</span>.
            </>
          )}{' '}
          Publishing replaces <span className="font-mono">{liveVersion}</span> with this version as
          it stands, so anything only <span className="font-mono">{liveVersion}</span> has is gone —
          the comparison shown is against <span className="font-mono">{liveVersion}</span>.
        </p>
      )}
      {!rejecting ? (
        <div className="flex flex-wrap gap-2">
          {canPublish && (
            <MakeLiveButton
              kind="publish"
              name={name}
              version={version}
              label={`${verb} ${version}`}
              confirmLabel={`${verb} ${version}`}
              className={DECISION_BUTTON}
              slotClassName={DECISION_SLOT}
              disabled={busy}
              mutation={publish}
              onDone={() => {
                toast.success(`Published ${name} ${version}.`);
                onDecided?.('published');
              }}
            />
          )}
          {canReject && (
            <div className={DECISION_SLOT}>
              <Button
                size="sm"
                variant="outline"
                className={cn(DECISION_BUTTON, 'w-full')}
                disabled={busy}
                onClick={() => {
                  publish.reset();
                  setRejecting(true);
                }}
              >
                Reject…
              </Button>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          <label htmlFor={noteId} className="block text-xs font-medium text-muted-foreground">
            Why reject {version}? The note is kept on the version and the drafting agent sees it.
          </label>
          <Textarea
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={2000}
            className="min-h-16 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            <ConfirmButton
              variant="outline"
              destructive
              disabled={busy || note.trim() === ''}
              question={`${name} ${version} is archived unpublished, with this note.`}
              confirmLabel={`Reject ${version}`}
              onConfirm={async () => {
                try {
                  await reject.mutateAsync({ name, version, note: note.trim() });
                  toast.success(`Rejected ${name} ${version}.`);
                  setRejecting(false);
                  setNote('');
                  onDecided?.('rejected');
                } catch {
                  // Drawn below.
                }
              }}
            >
              Reject {version}
            </ConfirmButton>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                reject.reset();
                setRejecting(false);
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {reject.error ? <RefusalNotice error={reject.error} doing={`reject ${version}`} /> : null}
    </div>
  );
}

/** Roll a once-live version back into place, through the same gate as a publish. */
export function RollbackButton({ name, version }: { name: string; version: string }) {
  const { rollback } = useVersionActions();
  return (
    <MakeLiveButton
      kind="rollback"
      name={name}
      version={version}
      label="Roll back to this"
      confirmLabel={`Roll back to ${version}`}
      size="xs"
      mutation={rollback}
      onDone={() => toast.success(`${name} ${version} is live again.`)}
    />
  );
}

type Phase =
  | { at: 'rest' }
  | { at: 'checking' }
  /** Armed against `live`; `was` is the live version a refused attempt expected. */
  | { at: 'armed'; live: string | null; was?: string | null };

/**
 * The question a move to live asks, built only from what the harness said is
 * live now.
 */
export function makeLiveQuestion(
  kind: 'publish' | 'rollback',
  name: string,
  version: string,
  live: string | null,
): string {
  if (kind === 'rollback') return `${version} goes live again${live ? `, replacing ${live}` : ''}.`;
  return live
    ? `${name} ${version} goes live, replacing live ${live} for every ref that pins no version.`
    : `${name} ${version} goes live, as its first live version.`;
}

/**
 * Publish or roll back, pinned to the live version the question named.
 *
 * Arming re-reads the skill (never the cache), and the confirm sends the live
 * version it showed. On `live_changed` it re-reads again and re-arms with the
 * new live version named — the operator confirms again or cancels. A burst of
 * clicks sends one request: the guard is a ref, as `ConfirmButton`'s is.
 */
function MakeLiveButton({
  kind,
  name,
  version,
  label,
  confirmLabel,
  mutation,
  onDone,
  disabled,
  className,
  slotClassName,
  size = 'sm',
}: {
  kind: 'publish' | 'rollback';
  name: string;
  version: string;
  label: string;
  confirmLabel: string;
  mutation: {
    mutateAsync: (v: MakeLive) => Promise<unknown>;
    reset: () => void;
    error: unknown;
    isPending: boolean;
  };
  onDone: () => void;
  disabled?: boolean;
  /** The button's own classes. */
  className?: string;
  /**
   * The wrapper's, for the place it takes in a row. Kept apart from the button's:
   * the wrapper used to take both, so `DECISION_BUTTON`'s padding and minimum
   * height applied twice — once around the button — and Reject beside it
   * stretched to the padded wrapper and stood taller than Publish.
   */
  slotClassName?: string;
  size?: 'xs' | 'sm';
}) {
  const fresh = useFreshSkill();
  const [phase, setPhase] = useState<Phase>({ at: 'rest' });
  const [readError, setReadError] = useState<unknown>(null);
  const inFlight = useRef(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const armed = phase.at === 'armed';

  useEffect(() => {
    if (armed) confirmRef.current?.focus();
  }, [armed]);

  // Escape cancels the question, not the page or dialog behind it.
  useEffect(() => {
    if (!armed) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.stopImmediatePropagation();
      e.preventDefault();
      setPhase({ at: 'rest' });
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [armed]);

  const arm = async (was?: string | null) => {
    setPhase({ at: 'checking' });
    setReadError(null);
    try {
      const skill = await fresh(name);
      setPhase({ at: 'armed', live: skill.live_version, was });
    } catch (err) {
      setReadError(err);
      setPhase({ at: 'rest' });
    }
  };

  const confirm = async () => {
    if (phase.at !== 'armed' || inFlight.current) return;
    inFlight.current = true;
    const expected = phase.live;
    try {
      await mutation.mutateAsync({ name, version, expectedLive: expected });
      setPhase({ at: 'rest' });
      onDone();
    } catch (err) {
      if (isSkillLibraryError(err) && err.code === 'live_changed') {
        // Someone moved live under the question. Ask again, naming what is live
        // now; the failed attempt is not repeated on the operator's behalf.
        await arm(expected);
      } else {
        setPhase({ at: 'rest' });
      }
    } finally {
      inFlight.current = false;
    }
  };

  const error = readError ?? mutation.error;
  const liveChanged = isSkillLibraryError(error) && error.code === 'live_changed';
  return (
    <div className={cn('space-y-2', !armed && slotClassName)}>
      {phase.at !== 'armed' ? (
        <Button
          size={size}
          variant="outline"
          className={cn(className, 'w-full')}
          disabled={disabled || phase.at === 'checking' || mutation.isPending}
          onClick={() => {
            mutation.reset();
            void arm();
          }}
        >
          {phase.at === 'checking' ? 'Checking what is live…' : label}
        </Button>
      ) : (
        <span
          role="group"
          aria-label={confirmLabel}
          className="flex min-w-0 flex-wrap items-center gap-1.5"
        >
          <span className="min-w-0 flex-1 text-xs leading-snug text-muted-foreground">
            {phase.was !== undefined && (
              <span className="block font-medium text-state-blocked">
                Nothing changed: live moved from {phase.was ?? 'nothing'} to{' '}
                {phase.live ?? 'nothing'} while you were deciding.
              </span>
            )}
            {makeLiveQuestion(kind, name, version, phase.live)}
          </span>
          <Button
            ref={confirmRef}
            size={size}
            className="h-7 shrink-0"
            disabled={mutation.isPending}
            onClick={() => void confirm()}
          >
            {confirmLabel}
          </Button>
          <Button
            size={size}
            variant="outline"
            className="h-7 shrink-0"
            onClick={() => setPhase({ at: 'rest' })}
          >
            Cancel
          </Button>
        </span>
      )}
      {error && !(liveChanged && armed) ? (
        <RefusalNotice
          error={error}
          doing={`${kind === 'publish' ? 'publish' : 'roll back to'} ${version}`}
        />
      ) : null}
    </div>
  );
}
