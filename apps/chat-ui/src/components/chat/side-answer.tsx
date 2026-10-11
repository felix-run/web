import { Button } from '@felix/ui/button';
import { MessageCircleQuestionIcon, XIcon } from 'lucide-react';
import type { SideQuestion } from '@/shell-context';
import { Response } from './response';

/**
 * The answer to `/ask`, beside the transcript rather than in it.
 *
 * The harness adds nothing to the thread for a side question, so drawing it as a turn would
 * claim the agent will read it later, which it will not. It sits above the composer with the
 * question it answers, says it was kept out of the conversation, and goes when dismissed or
 * when the next question replaces it.
 */
export function SideAnswerCard({ side, onDismiss }: { side: SideQuestion; onDismiss: () => void }) {
  const status = side.answer?.status;
  return (
    // The banners' measure and gutter: full-bleed it ran from the sidebar to the edge while
    // the composer under it held to the transcript's width.
    <div className="mx-auto mb-3 w-full max-w-3xl px-4 md:px-6">
      <section
        aria-label="Side question"
        aria-live="polite"
        className="rounded-xl border border-border/60 bg-card px-3.5 py-3 text-sm shadow-sheet"
      >
        <div className="flex items-start gap-2">
          <MessageCircleQuestionIcon
            aria-hidden
            className="mt-0.5 size-4 shrink-0 text-muted-foreground"
          />
          <p className="min-w-0 flex-1 font-medium text-foreground">{side.question}</p>
          <Button
            variant="ghost"
            size="icon"
            className="-mt-1 -mr-1 size-7 shrink-0 coarse:size-9"
            aria-label="Dismiss side question"
            onClick={onDismiss}
          >
            <XIcon className="size-4" />
          </Button>
        </div>
        <div className="mt-2 pl-6">
          {side.pending ? (
            <p className="shimmer shimmer-color-foreground text-muted-foreground">Asking…</p>
          ) : side.error ? (
            <p className="text-state-failed">{side.error}</p>
          ) : status === 'withheld' ? (
            <p className="text-muted-foreground">
              The agent's reply controls withheld this answer.
            </p>
          ) : status === 'not_in_context' ? (
            <p className="text-muted-foreground">
              This conversation doesn't hold the answer. Ask the agent directly to have it look.
            </p>
          ) : (
            <div className="max-w-none text-foreground">
              <Response>{side.answer?.answer ?? ''}</Response>
            </div>
          )}
          <p className="mt-2 text-xs text-muted-foreground">
            Not added to the conversation — the agent won't see this question or its answer.
          </p>
        </div>
      </section>
    </div>
  );
}
