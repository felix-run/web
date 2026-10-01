import { ChevronRightIcon } from 'lucide-react';
import { useId, useState } from 'react';
import { CodePane } from '@/components/approval/approval-decision';
import type { ChangeEvidence, PathChange } from '@/lib/changes';
import { cn } from '@/lib/utils';

/** How many paths to list before the footer says what was left out. */
export const CHANGES_VISIBLE = 8;

/**
 * "Changes on this thread": each workspace path a tool call named, and what was
 * done to it. See `collectChanges` for what a stat is allowed to claim.
 *
 * Rows rather than cards, and a chevron only on the rows that open — the ones a
 * write or edit was attempted on, which have evidence to show. A read has none
 * beyond its path, so it is a plain row.
 */
export function ChangesSection({
  changes,
  durableGap,
}: {
  changes: readonly PathChange[];
  /**
   * A durable run is in flight and has reported no tool call yet. Its stream
   * carries none until the harness folds them in, so an empty list here is the
   * run loop and not the absence of work — said as such, rather than as nothing.
   */
  durableGap: boolean;
}) {
  if (changes.length === 0 && !durableGap) return null;
  return (
    // Named: a `<section>` with no accessible name is announced as an anonymous
    // region, which is worse than no landmark at all.
    <section aria-labelledby="workspace-changes-heading">
      <h3
        id="workspace-changes-heading"
        className="mb-1.5 text-xs font-semibold text-muted-foreground"
      >
        Changes on this thread
      </h3>
      {durableGap && (
        <p className="mb-1 text-xs text-muted-foreground">Changes appear when the run finishes.</p>
      )}
      {changes.length > 0 && (
        <ul className="-mx-1 space-y-px">
          {changes.slice(0, CHANGES_VISIBLE).map((change) => (
            <ChangeRow key={change.path} change={change} />
          ))}
        </ul>
      )}
      {changes.length > CHANGES_VISIBLE && (
        <p className="mt-1 text-xs text-muted-foreground">
          and {changes.length - CHANGES_VISIBLE} more
        </p>
      )}
    </section>
  );
}

function ChangeRow({ change }: { change: PathChange }) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const { evidence } = change;

  const body = (
    <>
      <ChevronRightIcon
        aria-hidden
        className={cn(
          'size-3 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none',
          open && 'rotate-90',
          !evidence && 'invisible',
        )}
      />
      <PathText path={change.path} muted={!change.mutating} />
      <span
        className={cn(
          'ml-auto shrink-0 pl-2 font-mono text-xs tabular-nums',
          change.stat.tone === 'failed'
            ? 'text-state-failed'
            : change.changed
              ? 'text-foreground/80'
              : 'text-muted-foreground',
        )}
      >
        {change.stat.text}
      </span>
    </>
  );

  if (!evidence) {
    return (
      <li className="flex min-w-0 items-center gap-1 rounded px-1 py-0.5" title={change.path}>
        {body}
      </li>
    );
  }

  return (
    <li>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        title={change.path}
        className="flex w-full min-w-0 items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {body}
      </button>
      {open && (
        <div id={panelId} className="mt-1 mb-2 space-y-2 pl-5 pr-1">
          <Evidence evidence={evidence} />
        </div>
      )}
    </li>
  );
}

/**
 * The pane labels say what happened, so a call that was not applied must not be
 * labelled as though it was: "Written" under "Not applied" is a contradiction,
 * and the label is what a glance reads.
 */
function Evidence({ evidence }: { evidence: ChangeEvidence }) {
  const failed = Boolean(evidence.issue);
  return (
    <>
      {evidence.issue && (
        <p className="text-xs text-state-failed wrap-anywhere">
          Not applied — <span className="font-mono">{evidence.issue}</span>
        </p>
      )}
      {evidence.kind === 'edit' ? (
        <>
          <CodePane label={failed ? 'Would have replaced' : 'Replaced'}>
            {evidence.oldText}
          </CodePane>
          <CodePane label="With" emphasis>
            {evidence.newText}
          </CodePane>
        </>
      ) : (
        <CodePane
          label={
            evidence.kind === 'append'
              ? failed
                ? 'Would have appended'
                : 'Appended'
              : failed
                ? 'Would have written'
                : 'Written'
          }
          emphasis
        >
          {evidence.content}
        </CodePane>
      )}
    </>
  );
}

/**
 * A path whose filename survives the cut: the directory truncates and the name
 * does not, so eight rows under `src/components/…` stay told apart by the part
 * that differs. The full path is the row's `title`.
 */
function PathText({ path, muted }: { path: string; muted: boolean }) {
  const slash = path.lastIndexOf('/', path.length - 2);
  const dir = slash >= 0 ? path.slice(0, slash + 1) : '';
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  return (
    <span
      className={cn(
        'flex min-w-0 font-mono text-xs',
        muted ? 'text-muted-foreground' : 'text-foreground',
      )}
    >
      {dir && <span className="min-w-0 truncate text-muted-foreground">{dir}</span>}
      <span className={cn('truncate', dir ? 'shrink-0 max-w-full' : 'min-w-0')}>{name}</span>
    </span>
  );
}
