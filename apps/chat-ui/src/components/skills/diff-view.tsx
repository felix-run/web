import { useMemo, useState } from 'react';
import { type DiffLine, diffChunks, diffLines } from '@/lib/diff';
import { cn } from '@/lib/utils';

/**
 * Two texts as a unified line diff: what was removed, what was added, and the
 * unchanged lines around each change, with longer unchanged runs folded to a
 * count that opens on click.
 *
 * A change is never colour alone. Each line carries its `+` or `−` in the
 * gutter (and in its accessible text), and the counts say `added` and
 * `removed` in words. The labels name both sides, because "the diff" of two
 * versions read the wrong way round is a diff that says the opposite.
 */
export function DiffView({
  before,
  after,
  beforeLabel,
  afterLabel,
  context = 3,
  className,
  maxHeight = 'max-h-[480px]',
}: {
  before: string;
  after: string;
  /** What the left side is, e.g. `0.1.0` or `live`. */
  beforeLabel: string;
  afterLabel: string;
  context?: number;
  className?: string;
  maxHeight?: string;
}) {
  const diff = useMemo(() => diffLines(before, after), [before, after]);
  const chunks = useMemo(() => diffChunks(diff.lines, context), [diff, context]);
  const [opened, setOpened] = useState<Set<number>>(new Set());
  const same = diff.added === 0 && diff.removed === 0;

  return (
    <div className={cn('overflow-hidden rounded-lg border border-border/60', className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 bg-muted/40 px-3 py-1.5 text-xs">
        <span className="font-mono text-muted-foreground">
          {beforeLabel} <span aria-hidden>→</span>
          <span className="sr-only"> to </span> {afterLabel}
        </span>
        {same ? (
          <span className="text-muted-foreground">No differences</span>
        ) : (
          <span className="font-mono tabular-nums">
            <span className="text-state-done">+{diff.added}</span>
            <span className="sr-only"> added,</span>{' '}
            <span className="text-state-failed">−{diff.removed}</span>
            <span className="sr-only"> removed</span>
          </span>
        )}
        {!diff.exact && (
          <span className="text-muted-foreground">
            Too large to align line by line: shown as the old block, then the new one.
          </span>
        )}
      </div>
      {!same && (
        <div className={cn('overflow-auto bg-code-surface', maxHeight)}>
          <table className="w-full border-collapse font-mono text-xs leading-5">
            <tbody>
              {chunks.map((chunk, i) =>
                chunk.kind === 'fold' && !opened.has(i) ? (
                  <FoldRow
                    // Chunks are positional: a fold's identity is where it sits.
                    key={`fold-${i}`}
                    count={chunk.count}
                    onOpen={() => setOpened((prev) => new Set(prev).add(i))}
                  />
                ) : (
                  chunk.lines.map((line) => <Row key={rowKey(line)} line={line} />)
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function rowKey(line: DiffLine): string {
  return line.type === 'add'
    ? `a${line.newNo}`
    : line.type === 'remove'
      ? `r${line.oldNo}`
      : `s${line.oldNo}-${line.newNo}`;
}

function Row({ line }: { line: DiffLine }) {
  const sign = line.type === 'add' ? '+' : line.type === 'remove' ? '−' : ' ';
  const spoken = line.type === 'add' ? 'added' : line.type === 'remove' ? 'removed' : '';
  return (
    <tr
      className={cn(
        line.type === 'add' && 'bg-state-done/10',
        line.type === 'remove' && 'bg-state-failed/10',
      )}
    >
      <td className="w-10 px-2 text-right text-muted-foreground tabular-nums select-none">
        {line.type !== 'add' ? line.oldNo : ''}
      </td>
      <td className="w-10 px-2 text-right text-muted-foreground tabular-nums select-none">
        {line.type !== 'remove' ? line.newNo : ''}
      </td>
      <td
        className={cn(
          'w-4 text-center select-none',
          line.type === 'add' && 'text-state-done',
          line.type === 'remove' && 'text-state-failed',
        )}
      >
        <span aria-hidden>{sign}</span>
        {spoken && <span className="sr-only">{spoken}</span>}
      </td>
      <td className="pr-3 whitespace-pre-wrap break-all">{line.line || ' '}</td>
    </tr>
  );
}

function FoldRow({ count, onOpen }: { count: number; onOpen: () => void }) {
  return (
    <tr>
      <td colSpan={4} className="border-y border-border/40 bg-muted/40 px-2 py-0.5">
        <button
          type="button"
          onClick={onOpen}
          className="rounded-sm font-sans text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
        >
          {count} unchanged line{count === 1 ? '' : 's'}
        </button>
      </td>
    </tr>
  );
}
