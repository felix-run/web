import type { FeedbackStatus, SkillDetail, SkillFeedback } from '@felix/client';
import { Button } from '@felix/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@felix/ui/collapsible';
import { Skeleton } from '@felix/ui/skeleton';
import { Textarea } from '@felix/ui/textarea';
import { BotIcon, ChevronRightIcon, UserIcon } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import { PageSection, ViewSwitch } from '@/components/harness/panel';
import { ReadFailure } from '@/components/inspector/primitives';
import { cn } from '@/lib/utils';
import { StalledNotice } from './evals-panel';
import {
  isStalled,
  useFeedbackActions,
  useFeedbackInbox,
  useNowWhile,
  useSkillFeedback,
} from './queries';
import { RefusalNotice } from './refusal';
import { ago } from './skill-status';
import { VersionDiff } from './version-diff';
import { VersionPicker } from './version-picker';

const FILTERS = [
  ['all', 'All'],
  ['pending', 'Pending'],
  ['accepted', 'Accepted'],
  ['applied', 'Applied'],
  ['failed', 'Failed'],
  ['rejected', 'Rejected'],
] as const;

const STATUS_WORD: Record<FeedbackStatus, string> = {
  pending: 'pending',
  accepted: 'accepted',
  applied: 'applied',
  failed: 'failed',
  rejected: 'rejected',
};

/**
 * Why an improvement failed, in words. The harness writes `code: detail`; the
 * codes worth a sentence are the ones that say the *skill* moved on rather
 * than that something broke.
 */
export function feedbackFailure(error: string | null): string {
  if (!error) return 'The improvement failed and the harness gave no reason.';
  const code = error.split(':')[0]?.trim();
  switch (code) {
    case 'parent_changed':
      return 'Not applied: the skill gained a newer version after this feedback was filed, so the rewrite was not built on a stale one.';
    case 'parent_rejected':
      return 'Not applied: the version this feedback is about was rejected, and an improvement never builds on a rejected draft.';
    case 'attempts_exhausted':
      return 'Not applied: the worker took the job three times and never finished it.';
    case 'invalid_bundle':
      return 'Not applied: the model’s rewrite was not a valid SKILL.md for this skill, so nothing was saved.';
    case 'model_route':
      return 'Not applied: no model route was available to write the improvement.';
    default:
      return 'The improvement failed.';
  }
}

/**
 * One skill's feedback: file it, filter it, decide it, and follow an accepted
 * improvement through to the draft the worker wrote.
 *
 * Accepting with "improve with AI" queues a rewrite; it lands as a *draft* in
 * the review queue, never live. Once applied, the row links to that draft,
 * shows it against the version the feedback was about, and offers to load it
 * into the editor as the start of a new edit.
 */
export function FeedbackPanel({
  detail,
  version,
  onApplyToEditor,
}: {
  detail: SkillDetail;
  /** The version the form offers as the feedback's target: the live one when there is one. */
  version: string;
  onApplyToEditor: (version: string) => void;
}) {
  const name = detail.name;
  const [filter, setFilter] = useState<(typeof FILTERS)[number][0]>('all');
  const feedback = useSkillFeedback(name, filter === 'all' ? null : filter);
  const items = feedback.data?.items ?? [];
  const now = useNowWhile(items.some((f) => f.status === 'accepted' && f.improve));
  return (
    <div className="space-y-1">
      <PageSection title="File feedback">
        <FeedbackForm detail={detail} version={version} />
      </PageSection>
      <PageSection
        title="Feedback"
        meta={feedback.data ? `${items.length}${feedback.data.next_cursor ? '+' : ''}` : undefined}
        actions={
          <ViewSwitch
            label="Feedback status"
            value={filter}
            options={FILTERS}
            onChange={setFilter}
          />
        }
      >
        {feedback.error ? (
          <ReadFailure
            error={feedback.error}
            doing={`read ${name}'s feedback`}
            lastOkAt={feedback.data ? feedback.dataUpdatedAt : null}
            onRetry={() => void feedback.refetch()}
          />
        ) : null}
        {feedback.isPending ? (
          <Skeleton className="h-16 w-full rounded-md" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {filter === 'all' ? `No feedback on ${name} yet.` : `No ${filter} feedback.`}
          </p>
        ) : (
          <ul aria-label={`Feedback on ${name}`} className="divide-y divide-border/60">
            {items.map((f) => (
              <FeedbackRow
                key={f.id}
                feedback={f}
                onApplyToEditor={onApplyToEditor}
                now={now}
                onCheckAgain={() => void feedback.refetch()}
              />
            ))}
          </ul>
        )}
      </PageSection>
    </div>
  );
}

function FeedbackForm({ detail, version }: { detail: SkillDetail; version: string }) {
  const { submit } = useFeedbackActions();
  const [body, setBody] = useState('');
  const [patch, setPatch] = useState('');
  const [target, setTarget] = useState(version);
  const bodyId = useId();
  const patchId = useId();
  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!body.trim() || submit.isPending) return;
        submit.mutate(
          {
            name: detail.name,
            body: body.trim(),
            suggested_patch: patch.trim() || undefined,
            target_version: target,
          },
          {
            onSuccess: () => {
              toast.success('Feedback filed. It waits as pending until someone decides it.');
              setBody('');
              setPatch('');
            },
          },
        );
      }}
    >
      <VersionPicker
        versions={detail.versions.map((v) => v.version)}
        value={target}
        onChange={setTarget}
      />
      <label htmlFor={bodyId} className="block text-xs font-medium text-muted-foreground">
        What should change, and why
      </label>
      <Textarea
        id={bodyId}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        className="min-h-16 text-sm"
      />
      <label htmlFor={patchId} className="block text-xs font-medium text-muted-foreground">
        Suggested change (optional — text for the rewrite to start from)
      </label>
      <Textarea
        id={patchId}
        value={patch}
        onChange={(e) => setPatch(e.target.value)}
        className="min-h-12 font-mono text-xs"
      />
      {submit.error ? <RefusalNotice error={submit.error} doing="file feedback" /> : null}
      <Button type="submit" size="sm" disabled={!body.trim() || submit.isPending}>
        {submit.isPending ? 'Filing…' : 'File feedback'}
      </Button>
    </form>
  );
}

/** A feedback row with its decision, shared by a skill's Feedback tab and the library's inbox. */
export function FeedbackRow({
  feedback: f,
  showSkill = false,
  showStatus = true,
  onApplyToEditor,
  onCheckAgain,
  now,
}: {
  feedback: SkillFeedback;
  showSkill?: boolean;
  /**
   * Off in the inbox, which lists only pending feedback: an amber "pending" on
   * every row there spent the state colour on something the heading already says.
   */
  showStatus?: boolean;
  now?: number;
  onApplyToEditor?: (version: string) => void;
  /** Re-read the list, for an improvement the page has stopped polling. */
  onCheckAgain?: () => void;
}) {
  const Icon = f.source === 'agent' ? BotIcon : UserIcon;
  return (
    <li className="space-y-1.5 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
        {showSkill && (
          <Link
            to={`/harness/skills?skill=${encodeURIComponent(f.name)}&tab=feedback`}
            className="font-mono text-sm font-medium underline-offset-2 hover:underline"
          >
            {f.name}
          </Link>
        )}
        {showStatus && (
          <span
            className={cn(
              'rounded-full px-1.5 py-0.5 font-medium',
              f.status === 'pending'
                ? 'bg-state-blocked/15 text-state-blocked'
                : f.status === 'failed'
                  ? 'bg-state-failed/15 text-state-failed'
                  : 'bg-muted text-foreground',
            )}
          >
            {STATUS_WORD[f.status]}
          </span>
        )}
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <Icon aria-hidden className="size-3" />
          {f.source} <span className="font-mono">{f.author}</span>
        </span>
        <span className="text-muted-foreground">
          on <span className="font-mono text-foreground">{f.target_version}</span> ·{' '}
          {ago(f.created_at)}
        </span>
      </div>
      <p className="text-sm whitespace-pre-wrap break-words">{f.body}</p>
      {f.suggested_patch && (
        <pre className="max-h-40 overflow-auto rounded-md bg-code-surface p-2 font-mono text-xs whitespace-pre-wrap break-words">
          {f.suggested_patch}
        </pre>
      )}
      <FeedbackOutcome
        feedback={f}
        onApplyToEditor={onApplyToEditor}
        onCheckAgain={onCheckAgain}
        now={now}
      />
    </li>
  );
}

function FeedbackOutcome({
  feedback: f,
  onApplyToEditor,
  onCheckAgain,
  now,
}: {
  feedback: SkillFeedback;
  onApplyToEditor?: (version: string) => void;
  onCheckAgain?: () => void;
  now?: number;
}) {
  const [open, setOpen] = useState(false);
  if (f.status === 'pending') return <FeedbackDecision feedback={f} />;
  const decided = f.decided_by ? (
    <>
      {' '}
      by <span className="font-mono">{f.decided_by}</span>
      {f.decision_note ? (
        <>
          : <span className="whitespace-pre-wrap">{f.decision_note}</span>
        </>
      ) : null}
    </>
  ) : null;
  if (f.status === 'rejected') {
    return <p className="text-xs text-muted-foreground">Rejected{decided}.</p>;
  }
  if (f.status === 'accepted' && f.improve && isStalled(f, now)) {
    return <StalledNotice onCheckAgain={onCheckAgain} />;
  }
  if (f.status === 'accepted') {
    return (
      <p className="text-xs text-muted-foreground" role={f.improve ? 'status' : undefined}>
        Accepted{decided}.{' '}
        {f.improve
          ? `The worker is writing an improved draft${f.attempts > 0 ? ` (attempt ${f.attempts})` : ''}; it runs within a minute.`
          : 'No rewrite was asked for.'}
      </p>
    );
  }
  if (f.status === 'failed') {
    return (
      <div className="text-xs">
        <p className="text-state-failed">{feedbackFailure(f.error)}</p>
        {f.error && <p className="mt-0.5 font-mono break-words text-muted-foreground">{f.error}</p>}
        <p className="text-muted-foreground">
          After {f.attempts} attempt{f.attempts === 1 ? '' : 's'}.
        </p>
      </div>
    );
  }
  // applied
  const result = f.result_version;
  return (
    <div className="space-y-1.5 text-xs">
      <p>
        Applied: the worker wrote{' '}
        {result ? (
          <Link
            to={`/harness/skills?skill=${encodeURIComponent(f.name)}&tab=versions&v=${encodeURIComponent(result)}&against=${encodeURIComponent(f.target_version)}`}
            className="font-mono underline underline-offset-2"
          >
            {f.name} {result}
          </Link>
        ) : (
          'a draft'
        )}{' '}
        from it, a draft waiting for review
        {f.model ? (
          <>
            {' '}
            (by <span className="font-mono">{f.model}</span>)
          </>
        ) : null}
        .
      </p>
      {result && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger className="group inline-flex items-center gap-1 rounded-sm text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
            <ChevronRightIcon
              aria-hidden
              className="size-3.5 transition-transform group-data-[state=open]:rotate-90"
            />
            AI draft against {f.target_version}
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2">
            {open && <VersionDiff name={f.name} before={f.target_version} after={result} />}
          </CollapsibleContent>
        </Collapsible>
      )}
      {result && onApplyToEditor && (
        <ConfirmButton
          size="xs"
          variant="outline"
          question={`The editor loads ${result} as a new edit based on it; unsaved edits there are discarded.`}
          confirmLabel={`Load ${result}`}
          onConfirm={() => onApplyToEditor(result)}
        >
          Apply to editor
        </ConfirmButton>
      )}
    </div>
  );
}

function FeedbackDecision({ feedback: f }: { feedback: SkillFeedback }) {
  const { accept, reject } = useFeedbackActions();
  const [improve, setImprove] = useState(true);
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const improveId = useId();
  const noteId = useId();
  const busy = accept.isPending || reject.isPending;
  const error = accept.error ?? reject.error;
  return (
    <div className="space-y-2">
      {!rejecting ? (
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor={improveId} className="flex items-center gap-1.5 text-xs">
            <input
              id={improveId}
              type="checkbox"
              checked={improve}
              onChange={(e) => setImprove(e.target.checked)}
            />
            Improve with AI — a draft for review, never published
          </label>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={busy}
            onClick={() =>
              accept.mutate(
                { id: f.id, improve },
                {
                  onSuccess: () =>
                    toast.success(
                      improve ? 'Accepted; the worker will write a draft.' : 'Accepted.',
                    ),
                },
              )
            }
          >
            Accept
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            disabled={busy}
            onClick={() => setRejecting(true)}
          >
            Reject…
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <label htmlFor={noteId} className="block text-xs font-medium text-muted-foreground">
            Why reject it?
          </label>
          <Textarea
            id={noteId}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="min-h-12 text-sm"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              disabled={busy || note.trim() === ''}
              onClick={() => reject.mutate({ id: f.id, note: note.trim() })}
            >
              Reject feedback
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => setRejecting(false)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
      {error ? <RefusalNotice error={error} doing="decide this feedback" /> : null}
    </div>
  );
}

/** Pending feedback across every skill, oldest first — the library page's second queue. */
export function FeedbackInbox() {
  const inbox = useFeedbackInbox('pending');
  const items = useMemo(() => (inbox.data?.pages ?? []).flatMap((p) => p.items), [inbox.data]);
  if (inbox.isPending) return <Skeleton className="h-12 w-full rounded-md" />;
  return (
    <div className="space-y-2">
      {inbox.error ? (
        <ReadFailure
          error={inbox.error}
          doing="read the feedback waiting for a decision"
          lastOkAt={inbox.data ? inbox.dataUpdatedAt : null}
          onRetry={() => void inbox.refetch()}
        />
      ) : null}
      {items.length === 0 && !inbox.error ? (
        <p className="text-sm text-muted-foreground">No feedback is waiting for a decision.</p>
      ) : (
        <ul aria-label="Feedback waiting for a decision" className="divide-y divide-border/60">
          {items.map((f) => (
            <FeedbackRow key={f.id} feedback={f} showSkill showStatus={false} />
          ))}
        </ul>
      )}
      {inbox.hasNextPage && (
        <Button
          size="sm"
          variant="outline"
          className="text-xs"
          disabled={inbox.isFetchingNextPage}
          onClick={() => void inbox.fetchNextPage()}
        >
          Load more
        </Button>
      )}
    </div>
  );
}
