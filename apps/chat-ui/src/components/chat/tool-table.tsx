import type { Tabular } from '@felix/client';
import { useState } from 'react';
import { cn } from '@/lib/utils';

/** Rows drawn before the rest are summarised; a card is not a spreadsheet. */
export const MAX_TABLE_ROWS = 100;

/**
 * Tool output that `parseTabular` recognised, drawn as a table — with the raw
 * text one click away, because a table is a reading of the output and not the
 * output itself, and the exact bytes are what a bug report needs.
 *
 * Sticky header and capped height, so a long result scrolls inside the card with
 * its column names in view. Cells wrap rather than widen: a sideways scrollbar
 * inside a transcript is how the old JSON pane became unreadable.
 */
export function ToolTable({ table, raw }: { table: Tabular; raw: string }) {
  const [view, setView] = useState<'table' | 'raw'>('table');
  const shown = table.rows.slice(0, MAX_TABLE_ROWS);
  const hidden = table.rows.length - shown.length;
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium">Output</span>
        <span>
          {table.rows.length.toLocaleString()} {table.rows.length === 1 ? 'row' : 'rows'} ·{' '}
          {table.source.toUpperCase()}
        </span>
        <div role="group" aria-label="Output view" className="ml-auto flex gap-0.5">
          {(['table', 'raw'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              onClick={() => setView(v)}
              className={cn(
                'rounded px-1.5 py-0.5 capitalize',
                view === v ? 'bg-muted text-foreground' : 'hover:text-foreground',
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>
      {view === 'raw' ? (
        <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-background p-2.5 text-xs leading-relaxed text-foreground">
          {raw}
        </pre>
      ) : (
        <div className="max-h-80 overflow-auto rounded-lg bg-background">
          <table className="w-full border-collapse text-left text-xs">
            <thead className="sticky top-0 bg-background">
              <tr>
                {table.columns.map((c) => (
                  <th
                    key={c}
                    scope="col"
                    className="border-b border-border px-2 py-1.5 font-mono font-medium whitespace-nowrap text-muted-foreground"
                  >
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {shown.map((row, i) => (
                // Rows have no identity of their own; position is the identity here.
                // biome-ignore lint/suspicious/noArrayIndexKey: static rows, never reordered
                <tr key={i} className="border-b border-border/50 last:border-0">
                  {row.map((value, j) => (
                    <td
                      // biome-ignore lint/suspicious/noArrayIndexKey: columns are positional
                      key={j}
                      className="max-w-72 px-2 py-1 align-top wrap-anywhere text-foreground"
                    >
                      {value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {hidden > 0 && (
            <p className="border-t border-border px-2 py-1.5 text-xs text-muted-foreground">
              {hidden.toLocaleString()} more {hidden === 1 ? 'row' : 'rows'} — switch to Raw to see
              all of it.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
