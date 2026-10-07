import { type BranchPoint, interleaveTurn, plansInTurn } from '@felix/client';
import { promptTokens } from '@felix/protocol';
import {
  Attachment,
  AttachmentContent,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from '@felix/ui/attachment';
import { Button } from '@felix/ui/button';
import { ButtonGroup, ButtonGroupText } from '@felix/ui/button-group';
import { Marker, MarkerContent, MarkerIcon } from '@felix/ui/marker';
import { ChevronLeftIcon, ChevronRightIcon, ImageOffIcon, OctagonPauseIcon } from 'lucide-react';
import { useState } from 'react';
import { useDrawableUrl } from '@/hooks/use-drawable-url';
import { cn } from '@/lib/utils';
import type { Turn, TurnFeedback } from '@/types';
import { MessageActions } from './message-actions';
import { PlanCard } from './plan-card';
import { RateTurn } from './rate-turn';
import { Reasoning } from './reasoning';
import { Response } from './response';
import { RunStatusLine } from './run-status';
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
  onEdit,
  branch,
  onSwitchBranch,
  feedback,
  onRate,
  verbose = false,
}: {
  turn: Turn;
  /** This message's other versions, when it was edited. */
  branch?: BranchPoint;
  /** Show another version. Absent while a run is live. */
  onSwitchBranch?: (tipEventId: string) => void;
  streaming?: boolean;
  /** The operator's name for this turn, from the session snapshot. */
  label?: string;
  /** Set or clear it. Absent until the turn has a server event id. */
  onLabel?: (label: string | null) => void;
  /** Provided only for the last assistant turn (enables Regenerate). */
  onRegenerate?: () => void;
  /** Rewind the server leaf to this turn's event id. */
  onRewind?: () => void;
  /** Replace a user turn's text and run from it. Absent while that cannot happen. */
  onEdit?: (text: string) => void;
  /** This answer's rating, from the snapshot. */
  feedback?: TurnFeedback;
  /** Rate it. Provided for assistant turns only. */
  onRate?: (rating: 'up' | 'down' | null, opts?: { note?: string; evalDataset?: string }) => void;
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
      <UserTurn
        turn={turn}
        onRewind={onRewind}
        {...(branch ? { branch } : {})}
        {...(onSwitchBranch ? { onSwitchBranch } : {})}
        {...(onEdit ? { onEdit } : {})}
        {...(label === undefined ? {} : { label })}
        {...(onLabel ? { onLabel } : {})}
      />
    );
  }

  const empty = !turn.content && !turn.tools?.length;
  // Plain, not memoised: this runs after the early returns above, where a hook
  // would be conditional, and reading a turn's plan calls is cheap.
  const plans = plansInTurn(turn.tools);
  const toolCount = turn.tools?.length ?? 0;
  return (
    <div className="group flex w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-muted-foreground">Felix</span>
        {streaming && !empty && !turn.runStatus && (
          <span className="text-xs text-muted-foreground">streaming</span>
        )}
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
          // A plan's calls collapse into one card where the plan first appears,
          // showing its newest state. Verbose still shows every call underneath.
          const planId = plans.anchorOf.get(segment.index);
          const plan = planId ? plans.latest.get(planId) : undefined;
          if (plan) {
            return (
              <div key={`segment-${i}`} className="space-y-2">
                <PlanCard plan={plan} live={streaming === true} />
                {verbose && <Tool tool={segment.tool} verbose={verbose} />}
              </div>
            );
          }
          if (plans.folded.has(segment.index) && !verbose) return null;
          return <Tool key={`segment-${i}`} tool={segment.tool} verbose={verbose} />;
        }
        if (segment.kind === 'reasoning') {
          // Only the final block is still being written, and only while the turn is.
          const last = i === arr.length - 1;
          return (
            <Reasoning key={`segment-${i}`} text={segment.text} streaming={streaming && last} />
          );
        }
        // A durable run's status line is the engine talking, not the agent: drawn as
        // prose it read as the reply, so it takes the run readout's grammar instead.
        if (turn.runStatus) {
          return (
            <RunStatusLine
              key={`segment-${i}`}
              text={segment.text}
              tone={turn.runStatus}
              live={!!streaming}
            />
          );
        }
        return (
          <div key={`segment-${i}`} className="max-w-none text-base text-foreground">
            <Response>{segment.text}</Response>
          </div>
        );
      })}

      {turn.stop && (
        // A note about how the turn ended, in the failure-adjacent amber it always
        // used: the answer above is cut short, and the operator may want to continue.
        <Marker
          className="text-xs text-state-blocked"
          title="The react loop hit spec.recursion_limit before the model finished; the answer above is cut short"
        >
          <MarkerIcon>
            <OctagonPauseIcon className="size-3.5" />
          </MarkerIcon>
          <MarkerContent>
            Stopped at the step limit
            {turn.stop.limit === undefined ? '' : ` (${turn.stop.limit})`} with tool calls still
            pending
          </MarkerContent>
        </Marker>
      )}

      {turn.usage && <UsageLine usage={turn.usage} />}

      {/* A turn carrying reasoning already says "Thinking" in its own block. */}
      {empty && streaming && !turn.reasoning?.length && <AwaitingStatus />}

      {!streaming && !empty && (
        <div className="flex flex-wrap items-center gap-0.5">
          {/* First, so a rating — which stays visible — sits at the edge rather than
              floating after action buttons that are invisible until hover. */}
          {onRate && <RateTurn onRate={onRate} {...(feedback ? { feedback } : {})} />}
          <MessageActions
            content={turn.content}
            onRegenerate={onRegenerate}
            onRewind={onRewind}
            {...(label === undefined ? {} : { label })}
            {...(onLabel ? { onLabel } : {})}
          />
        </div>
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
/**
 * Sent, and nothing back yet. The sweep is what says the wait is live rather than
 * stalled; it brightens toward the foreground, so the muted text never dips below
 * its own contrast, and it stops under reduced motion with the words unchanged.
 */
function AwaitingStatus() {
  return (
    <Marker role="status" aria-live="polite" className="text-xs">
      <MarkerContent className="shimmer shimmer-color-foreground">
        Waiting for the harness…
      </MarkerContent>
    </Marker>
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

/**
 * The operator's turn, and the one place a sent message can be rewritten.
 *
 * The editor replaces the text where it was rather than opening in the composer:
 * what is being changed is *this* message, and the turns below it are what the
 * edit sets aside, so they should stay in view while the new text is written.
 */
function UserTurn({
  turn,
  label,
  onLabel,
  onRewind,
  onEdit,
  branch,
  onSwitchBranch,
}: {
  turn: Turn;
  branch?: BranchPoint;
  onSwitchBranch?: (tipEventId: string) => void;
  label?: string;
  onLabel?: (label: string | null) => void;
  onRewind?: () => void;
  onEdit?: (text: string) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null && !!onEdit;
  const changed = editing && draft.trim().length > 0 && draft.trim() !== turn.content.trim();
  const save = () => {
    if (!changed || !onEdit) return;
    onEdit(draft);
    setDraft(null);
  };

  return (
    <div className="group flex w-full flex-col gap-1.5">
      <div className="border-l-2 border-foreground/25 py-0.5 pl-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-muted-foreground">You</span>
          {/* Outside the actions row on purpose: that row is hidden until hover,
              and a label nobody can see without hunting for it is not a label. */}
          {label && <LabelChip label={label} />}
          {branch && <VersionSwitcher branch={branch} onSwitch={onSwitchBranch} />}
        </div>
        {turn.attachments && turn.attachments.length > 0 && (
          <AttachmentGroup className="mt-1.5" aria-label="Attached images">
            {turn.attachments.map((a) => (
              <AttachedImage key={a.url} url={a.url} alt={a.filename ?? 'attachment'} />
            ))}
          </AttachmentGroup>
        )}
        {editing ? (
          <div className="mt-1 flex flex-col gap-2">
            <textarea
              // biome-ignore lint/a11y/noAutofocus: the editor was just opened for this
              autoFocus
              aria-label="Edit message"
              value={draft}
              rows={Math.min(12, Math.max(2, draft.split('\n').length))}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setDraft(null);
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  save();
                }
              }}
              className="w-full resize-y rounded-md border border-border bg-background px-2.5 py-2 text-base text-foreground outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={save} disabled={!changed}>
                Send edit
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setDraft(null)}>
                Cancel
              </Button>
              {/* Says what happens to the turns below before it happens, the way
                  Rewind's tooltip does — they are set aside, not deleted. */}
              <span className="text-xs text-muted-foreground">
                Replies below move to another branch; nothing is deleted.
              </span>
            </div>
          </div>
        ) : (
          /* `wrap-anywhere`, not `break-words`: a commit hash, a path or a URL has no
             space to wrap at, and unwrapped it overflowed the turn and gave the
             whole transcript a sideways scroll at phone width (690px of content in
             a 368px column). Plain text has no table or code block that would want
             its words kept whole, so the stronger rule costs nothing here. */
          turn.content && (
            <div className="mt-1 whitespace-pre-wrap wrap-anywhere text-base text-foreground">
              {turn.content}
            </div>
          )
        )}
      </div>
      {!editing && (
        <MessageActions
          content={turn.content}
          onRewind={onRewind}
          {...(onEdit ? { onEdit: () => setDraft(turn.content) } : {})}
          {...(label === undefined ? {} : { label })}
          {...(onLabel ? { onLabel } : {})}
        />
      )}
    </div>
  );
}

/**
 * One call's tokens. `in` is the whole prompt: the harness reports cached tokens
 * apart from `input`, and counting `input` alone drew `3 in` for a 1,035-token
 * call. How much of it came from the cache goes in the title rather than the line,
 * because it changes what the turn cost and not how big it was.
 */
function UsageLine({ usage }: { usage: NonNullable<Turn['usage']> }) {
  const prompt = promptTokens(usage);
  const cached = (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
  return (
    <div
      className="font-mono text-xs text-muted-foreground"
      title={
        cached > 0
          ? `Tokens for this turn. ${cached.toLocaleString()} of the ${prompt.toLocaleString()} in went through the prompt cache.`
          : 'Tokens for this turn'
      }
    >
      {prompt.toLocaleString()} in · {usage.output.toLocaleString()} out ·{' '}
      {(prompt + usage.output).toLocaleString()} tok
    </div>
  );
}

/**
 * One attached image. A stored upload arrives as `felix-file://<id>`, which no
 * browser can draw, so it is fetched once and drawn from the bytes; a reference
 * whose upload is gone says so in place of the image rather than leaving a
 * broken-image glyph that reads as a rendering bug.
 */
function AttachedImage({ url, alt }: { url: string; alt: string }) {
  const src = useDrawableUrl(url);

  // One card in three states: fetching the bytes reads as processing (the title
  // sweeps), an upload the harness no longer holds is an error said in words, and
  // a drawn image is done. The name is the title in every state, because "which
  // image" is the question each of them answers.
  const state = src === null ? 'error' : src === undefined ? 'processing' : 'done';
  return (
    <Attachment state={state} orientation="vertical">
      <AttachmentMedia variant={src ? 'image' : 'icon'}>
        {src ? (
          <img src={src} alt={alt} />
        ) : src === null ? (
          <ImageOffIcon aria-hidden />
        ) : (
          <span role="img" aria-label={`${alt}, loading`} />
        )}
      </AttachmentMedia>
      <AttachmentContent>
        {/* The failure is a sentence, so it wraps rather than truncating to
            "Image no longer…", which hid the one word that explains it. */}
        <AttachmentTitle
          title={alt}
          className={cn(src === null && 'line-clamp-2 whitespace-normal')}
        >
          {src === null ? 'Image no longer stored' : alt}
        </AttachmentTitle>
      </AttachmentContent>
    </Attachment>
  );
}

/**
 * `‹ 2 of 3 ›` on a message that was edited: the versions of it the session holds.
 *
 * AI Elements' MessageBranch keeps every version's content in React and switches
 * between them locally; here only the active branch is ever loaded, and a switch is
 * a rewind on the harness, so the selector is built from the same ButtonGroup it
 * uses and driven by `branchPoints`. Always visible rather than in the hover row:
 * that a message has other versions is worth knowing without hunting for it.
 */
function VersionSwitcher({
  branch,
  onSwitch,
}: {
  branch: BranchPoint;
  onSwitch: ((tipEventId: string) => void) | undefined;
}) {
  const total = branch.tips.length;
  const go = (offset: number) => {
    const tip = branch.tips[(branch.index + offset + total) % total];
    if (tip) onSwitch?.(tip);
  };
  return (
    <ButtonGroup aria-label="Versions of this message" className="items-center">
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Previous version"
        disabled={!onSwitch}
        onClick={() => go(-1)}
      >
        <ChevronLeftIcon />
      </Button>
      <ButtonGroupText className="h-6 border-0 bg-transparent px-1 font-mono text-xs text-muted-foreground tabular-nums shadow-none">
        {branch.index + 1} of {total}
      </ButtonGroupText>
      <Button
        variant="ghost"
        size="icon-xs"
        aria-label="Next version"
        disabled={!onSwitch}
        onClick={() => go(1)}
      >
        <ChevronRightIcon />
      </Button>
    </ButtonGroup>
  );
}
