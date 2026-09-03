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
