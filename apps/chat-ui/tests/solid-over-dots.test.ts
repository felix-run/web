import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * Nothing with a fill may let the dot grid through it.
 *
 * The grid is painted under the transcript's `<main>`, and an alpha tint such as
 * `bg-muted/30` mixes its colour with *transparent* — so over the grid the dots run
 * straight through a tool card, a starter card or a button, as if it had no fill.
 * It compiles, it looks right on any page without the grid, and nothing reports
 * it. `bg-solid-muted/30` mixes with `--background` instead (`index.css`).
 *
 * The scan is over the files that render straight onto the grid. The composer's
 * own files are not in it: they render inside the dock, which is opaque, and the
 * dock itself is in `workbench.tsx`, which is.
 */

const SRC = new URL('../src/', import.meta.url);

const OVER_THE_GRID = [
  'routes/workbench.tsx',
  'components/chat/conversation.tsx',
  'components/chat/greeting.tsx',
  'components/chat/starter-prompts.tsx',
  'components/chat/message.tsx',
  'components/chat/message-actions.tsx',
  'components/chat/reasoning.tsx',
  'components/chat/response.tsx',
  'components/chat/run-status.tsx',
  'components/chat/tool.tsx',
];

/**
 * Alpha fills that are allowed, by file, each for a reason that is not "it looks
 * fine": it sits on an opaque parent, or it is a mark rather than a surface.
 */
const ALLOWED: Record<string, string[]> = {
  // The header row's hover, inside the tool card's own opaque fill.
  'components/chat/tool.tsx': ['hover:bg-muted/40'],
  // A 6px state dot: a mark, not a surface anything is read through.
  'components/chat/run-status.tsx': ['bg-muted-foreground/50'],
};

/** `bg-<token>/<n>` with any variant prefix, excluding `bg-solid-*`. */
const ALPHA_FILL = /(?<![\w-])((?:[\w-]+:)*bg-(?!solid-)[a-z][\w-]*\/\d+)(?![\w-])/g;

function read(path: string): string {
  return readFileSync(new URL(path, SRC), 'utf8');
}

describe('surfaces over the dot grid', () => {
  it('the grid is still where this list assumes it is', () => {
    // If the texture moves, the file list above is checking the wrong surfaces.
    expect(read('routes/workbench.tsx')).toContain('bg-dots');
  });

  it.each(OVER_THE_GRID)('%s has no alpha fill', (path) => {
    const found = [...read(path).matchAll(ALPHA_FILL)].map((m) => m[1]);
    const allowed = ALLOWED[path] ?? [];
    expect(found.filter((cls) => !allowed.includes(cls))).toEqual([]);
  });

  it('every allowlisted fill still exists', () => {
    // A stale entry would quietly allow the same class back in later.
    for (const [path, classes] of Object.entries(ALLOWED)) {
      const found = [...read(path).matchAll(ALPHA_FILL)].map((m) => m[1]);
      for (const cls of classes) expect(found, `${path}: ${cls}`).toContain(cls);
    }
  });
});
