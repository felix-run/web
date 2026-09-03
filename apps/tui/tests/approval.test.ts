import { describe, expect, it } from 'bun:test';
import type { PendingApproval } from '@felix/client';
import { writeDiff } from '../src/approval';

/**
 * The three states of `PendingApproval.before` are three different decisions,
 * and conflating them is the bug this guards: `undefined` is "not a write, so
 * there is nothing to diff", `null` is "the file does not exist yet, so the
 * change is all of it", and a string is an edit. A `?? ''` that swallowed the
 * first would offer a diff of every tool call against nothing.
 */

const write = (over: Partial<PendingApproval> = {}): PendingApproval => ({
  approvalId: 'ap-1',
  toolName: 'write_file',
  args: { path: 'src/app.tsx', content: 'const a = 1;\n' },
  before: 'const a = 0;\n',
  ...over,
});

describe('writeDiff', () => {
  it('diffs an edit, and names the file', () => {
    const diff = writeDiff(write());
    expect(diff?.path).toBe('src/app.tsx');
    expect(diff?.isNew).toBe(false);
    expect(diff?.patch).toContain('-const a = 0;');
    expect(diff?.patch).toContain('+const a = 1;');
    expect(diff?.omitted).toBe(0);
  });

  it('treats a file that does not exist yet as new, not as an edit of nothing', () => {
    const diff = writeDiff(write({ before: null }));
    expect(diff?.isNew).toBe(true);
    expect(diff?.patch).toContain('+const a = 1;');
  });

  it('offers nothing for a tool that is not a write', () => {
    expect(
      writeDiff({ approvalId: 'a', toolName: 'run_command', args: { command: 'ls' } }),
    ).toBeNull();
  });

  it('offers nothing when the new content is not text', () => {
    expect(writeDiff(write({ args: { path: 'x', content: { not: 'a string' } } }))).toBeNull();
  });

  it('still works when the tool did not name a path', () => {
    const diff = writeDiff(write({ args: { content: 'hello\n' } }));
    expect(diff?.path).toBe('file');
  });

  /**
   * The cap is what keeps the y/n line on screen. Without it a whole-file
   * rewrite pushes the decision off the bottom of the terminal.
   */
  it('caps the body and reports what it cut', () => {
    const huge = Array.from({ length: 200 }, (_, i) => `line ${i};`).join('\n');
    const diff = writeDiff(write({ before: '', args: { path: 'big.ts', content: huge } }), 10);
    expect(diff?.rows).toBeLessThanOrEqual(10);
    expect(diff?.omitted).toBeGreaterThan(150);
  });

  it('sizes a small diff to what it needs rather than to the cap', () => {
    const diff = writeDiff(write(), 16);
    expect(diff?.rows).toBeLessThan(16);
    expect(diff?.rows).toBeGreaterThan(0);
  });
});

/**
 * A unified diff cannot be truncated by counting rows.
 *
 * Every `@@` hunk declares how many lines follow it, so a body cut part-way
 * down contradicts its own header — and `DiffRenderable` does not shrug that
 * off. It refuses the patch and prints `Error parsing diff: Added line count
 * did not match` followed by the raw text, which is what a write approval on
 * any file long enough to need two hunks was showing.
 *
 * The invariant below is the one that matters, and it is checked at *every*
 * budget rather than at a chosen one: whatever the cap, the patch that comes
 * out must still describe itself correctly.
 */
describe('the patch stays a patch at any size', () => {
  const before = Array.from({ length: 60 }, (_, i) => `const line${i} = ${i};`).join('\n');
  const after = before
    .replace('const line3 = 3;', 'const line3 = 999;')
    .replace('const line40 = 40;', 'const line40 = 40; // touched')
    .concat('\nconst appended = true;\n');
  const edit = write({ before, args: { path: 'big.ts', content: after } });

  /** Re-derive each hunk's counts from its body and compare with its header. */
  const headersAgree = (patch: string): boolean => {
    const rows = patch.split('\n').slice(4);
    let header: RegExpExecArray | null = null;
    let oldSeen = 0;
    let newSeen = 0;
    const check = () => !header || (Number(header[2]) === oldSeen && Number(header[4]) === newSeen);

    for (const row of rows) {
      if (row.startsWith('@@')) {
        if (!check()) return false;
        header = /^@@ -(\d+),(\d+) \+(\d+),(\d+) @@/.exec(row);
        oldSeen = 0;
        newSeen = 0;
        continue;
      }
      if (!header || row.length === 0) continue;
      if (row.startsWith('-')) oldSeen++;
      else if (row.startsWith('+')) newSeen++;
      else if (!row.startsWith('\\')) {
        oldSeen++;
        newSeen++;
      }
    }
    return check();
  };

  it('produces a self-consistent patch at every budget from 1 to 40', () => {
    for (let rows = 1; rows <= 40; rows++) {
      const diff = writeDiff(edit, rows);
      expect(diff).not.toBeNull();
      if (!headersAgree(diff?.patch ?? '')) {
        throw new Error(`hunk headers disagree with the body at rows=${rows}:\n${diff?.patch}`);
      }
    }
  });

  it('never exceeds the budget it was given', () => {
    for (let rows = 1; rows <= 40; rows++) {
      expect(writeDiff(edit, rows)?.rows).toBeLessThanOrEqual(rows);
    }
  });

  /** A budget too small for even one hunk still has to show *something*. */
  it('shows part of the first hunk rather than an empty frame', () => {
    const diff = writeDiff(edit, 4);
    expect(diff?.patch).toContain('@@');
    expect(diff?.omitted).toBeGreaterThan(0);
  });

  it('reports everything it dropped, across all hunks', () => {
    const small = writeDiff(edit, 8);
    const large = writeDiff(edit, 200);
    expect(large?.omitted).toBe(0);
    expect(small?.omitted).toBeGreaterThan(0);
  });
});
