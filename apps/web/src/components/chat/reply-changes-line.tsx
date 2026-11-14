import { FileDiffIcon } from 'lucide-react';

/**
 * One quiet line under a reply that changed files: how many, and Review, which
 * opens the reply's changes in the side pane.
 *
 * The everyday surface has no run instrument, so its Changes tab is out of
 * reach there, and the tool cards say what each call did but not what the reply
 * did to the workspace as a whole. Drawn in every view: in harness view it is
 * the same answer scoped to one reply, where the instrument's tab is the thread.
 *
 * Only for files a write, edit, delete or rename *landed* on — a denied or
 * failed call changed nothing, and its card already says so.
 */
export function ReplyChangesLine({ files, onReview }: { files: number; onReview: () => void }) {
  const noun = files === 1 ? 'file' : 'files';
  return (
    <div
      data-slot="reply-changes"
      className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground"
    >
      <FileDiffIcon aria-hidden className="size-3.5 shrink-0" />
      <span>
        {files} {noun} changed
      </span>
      <span aria-hidden>·</span>
      <button
        type="button"
        onClick={onReview}
        aria-label={`Review the ${files} ${noun} this reply changed`}
        className="rounded-sm underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring coarse:py-1"
      >
        Review
      </button>
    </div>
  );
}
