import { isSkillLibraryError, type SkillPreview } from '@felix/client';
import { Button } from '@felix/ui/button';
import { Textarea } from '@felix/ui/textarea';
import { CircleAlertIcon } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { DECISION_BUTTON } from '@/components/approval/approval-decision';
import { ConfirmButton } from '@/components/confirm-button';
import { skillEditHref } from '@/lib/skill-calls';
import { cn } from '@/lib/utils';
import { GateVerdictLine } from './gate-line';
import {
  type MakeLive,
  useFreshPreview,
  useFreshSkill,
  useKnownPreview,
  useVersionActions,
} from './queries';
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
 *
 * A draft the gate has refused is not offered Publish. The harness has no
 * override, so a button whose one outcome is a refusal was a question with no
 * yes; the slot becomes *Edit to fix*, beside Reject. That needs the verdict
 * already in hand — read by a `GateLine` on screen or by a confirm that armed —
 * and when it is not, Publish stays, and arming reads it.
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
  showsVerdict = false,
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
  /**
   * The host draws the gate's verdict right above. Otherwise a refused draft's
   * slot says the verdict itself, since the button it replaces would be gone
   * with no word why.
   */
  showsVerdict?: boolean;
  className?: string;
}) {
  const { publish, reject } = useVersionActions();
  const known = useKnownPreview(name, version);
  const refused = known?.policy_passes === false ? known : null;
  const failure = publish.error ?? reject.error;
  useEffect(() => {
    if (failure && isForbidden(failure)) onForbidden?.();
  }, [failure, onForbidden]);
  const [rejecting, setRejecting] = useState(false);
  // While Publish asks its question, the question has the row: Reject beside a
  // wrapping sentence and two more buttons was a reflow, then a second row.
  const [arming, setArming] = useState(false);
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
        // A fact about the decision, not a person being asked to act: the shape
        // and the words carry it, and amber stays for what waits on someone.
        <p role="note" className="flex items-start gap-1.5 text-xs text-foreground">
          <CircleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" />
          <span className="min-w-0">
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
            Publishing replaces <span className="font-mono">{liveVersion}</span> with this version
            as it stands, so anything only <span className="font-mono">{liveVersion}</span> has is
            gone — the comparison shown is against <span className="font-mono">{liveVersion}</span>.
          </span>
        </p>
      )}
      {refused && !showsVerdict && <GateVerdictLine preview={refused} />}
      {!rejecting ? (
        <div className="flex flex-wrap gap-2">
          {canPublish && refused && (
            <div className={DECISION_SLOT}>
              <Button asChild size="sm" variant="outline" className={cn(DECISION_BUTTON, 'w-full')}>
                <Link to={skillEditHref(name)}>Edit to fix</Link>
              </Button>
            </div>
          )}
          {canPublish && !refused && (
            <MakeLiveButton
              kind="publish"
              name={name}
              version={version}
              label={`Publish ${version}`}
              confirmLabel={`Publish ${version}`}
              className={DECISION_BUTTON}
              slotClassName={DECISION_SLOT}
              disabled={busy}
              mutation={publish}
              onArmed={setArming}
              onDone={() => {
                toast.success(`Published ${name} ${version}.`);
                onDecided?.('published');
              }}
            />
          )}
          {canReject && !arming && (
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
              question={`${name} ${version} is archived unpublished, with this note. A rejected version can never be published.`}
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
      label={`Roll back to ${version}`}
      confirmLabel={`Roll back to ${version}`}
      // Its own width, not the row's: a past version's way back should not
      // weigh what a draft's Publish does.
      className="w-auto"
      mutation={rollback}
      onDone={() => toast.success(`${name} ${version} is live again.`)}
    />
  );
}

type Phase =
  | { at: 'rest' }
  | { at: 'checking' }
  /**
   * Armed against `live`; `was` is the live version a refused attempt expected.
   * `gate` is the verdict read alongside it, or null when that read failed.
   */
  | { at: 'armed'; live: string | null; was?: string | null; gate: SkillPreview | null };

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
  onArmed,
  disabled,
  className,
  slotClassName,
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
  /** Told when the question opens and closes, so a host can give it the row. */
  onArmed?: (armed: boolean) => void;
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
}) {
  const fresh = useFreshSkill();
  const freshPreview = useFreshPreview();
  const [phase, setPhase] = useState<Phase>({ at: 'rest' });
  const [readError, setReadError] = useState<unknown>(null);
  const inFlight = useRef(false);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const questionId = useId();
  const armed = phase.at === 'armed';

  useEffect(() => {
    if (armed) confirmRef.current?.focus();
  }, [armed]);
  useEffect(() => onArmed?.(armed), [armed, onArmed]);
  // Unmounted mid-question — a refused verdict swaps the slot out — is closed.
  useEffect(() => () => onArmed?.(false), [onArmed]);

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
      // The gate's verdict rides along, so the question is never asked without
      // it; a failed read of it costs the line, not the decision — the harness
      // checks again on the publish itself.
      const [skill, gate] = await Promise.all([
        fresh(name),
        freshPreview(name, version).catch(() => null),
      ]);
      // A body with no verdict in it is a read that failed, not a refusal.
      setPhase({
        at: 'armed',
        live: skill.live_version,
        was,
        gate: typeof gate?.policy_passes === 'boolean' ? gate : null,
      });
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

  // The gate has already said no: the question is not asked, because the
  // harness would refuse a yes. What is left is the verdict and a way out.
  const gateRefuses = phase.at === 'armed' && phase.gate?.policy_passes === false;
  const error = readError ?? mutation.error;
  const liveChanged = isSkillLibraryError(error) && error.code === 'live_changed';
  return (
    <div className={cn('space-y-2', !armed && slotClassName)}>
      {phase.at !== 'armed' ? (
        <Button
          size="sm"
          variant="outline"
          className={cn('w-full', className)}
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
          <span
            id={questionId}
            className="min-w-0 flex-1 text-xs leading-snug text-muted-foreground"
          >
            {phase.was !== undefined && (
              <span className="block font-medium text-state-blocked">
                Nothing changed: live moved from {phase.was ?? 'nothing'} to{' '}
                {phase.live ?? 'nothing'} while you were deciding.
              </span>
            )}
            {!gateRefuses && (
              <span className="block">{makeLiveQuestion(kind, name, version, phase.live)}</span>
            )}
            {phase.gate ? (
              <GateVerdictLine preview={phase.gate} className="mt-0.5" />
            ) : (
              <span className="block">
                The gate's verdict could not be read; the harness checks again on{' '}
                {kind === 'publish' ? 'publish' : 'rollback'}.
              </span>
            )}
            {gateRefuses && (
              <span className="block">
                Nothing was sent: {version} cannot go live until the gate passes it.
              </span>
            )}
          </span>
          {!gateRefuses && (
            <Button
              ref={confirmRef}
              size="sm"
              className="h-7 shrink-0"
              // Focus lands here, so the question and the verdict are what a
              // screen reader says with it — not only the button's own name.
              aria-describedby={questionId}
              disabled={mutation.isPending}
              onClick={() => void confirm()}
            >
              {confirmLabel}
            </Button>
          )}
          <Button
            ref={gateRefuses ? confirmRef : undefined}
            size="sm"
            variant="outline"
            className="h-7 shrink-0"
            aria-describedby={gateRefuses ? questionId : undefined}
            onClick={() => setPhase({ at: 'rest' })}
          >
            {gateRefuses ? 'Close' : 'Cancel'}
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
