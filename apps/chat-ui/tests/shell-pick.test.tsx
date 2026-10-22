/** @vitest-environment happy-dom */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@testing-library/react';
import { memo } from 'react';
import { describe, expect, it } from 'vitest';
import {
  ShellProvider,
  type ShellValue,
  useOptionalShellPick,
  useShellPick,
} from '../src/shell-context';

const shell = (over: Partial<ShellValue>) =>
  ({ threadId: 't1', turns: [], streaming: false, ...over }) as unknown as ShellValue;

describe('useShellPick', () => {
  it('re-renders a memoised reader only when a field it picked changes', () => {
    const renders: string[] = [];
    const Reader = memo(function Reader() {
      const { threadId } = useShellPick('threadId');
      renders.push(threadId);
      return null;
    });
    const tree = (value: ShellValue) => (
      <ShellProvider value={value}>
        <Reader />
      </ShellProvider>
    );
    const { rerender } = render(tree(shell({})));
    // A streamed frame: a new shell value, a new transcript, the same thread.
    rerender(tree(shell({ turns: [{ id: 'a', role: 'assistant', content: 'x' }] })));
    rerender(tree(shell({ turns: [{ id: 'a', role: 'assistant', content: 'xy' }] })));
    expect(renders).toEqual(['t1']);
    rerender(tree(shell({ threadId: 't2' })));
    expect(renders).toEqual(['t1', 't2']);
  });

  it('is null outside the shell, for pieces tests mount alone', () => {
    let seen: unknown = 'unset';
    function Reader() {
      seen = useOptionalShellPick('threadId');
      return null;
    }
    render(<Reader />);
    expect(seen).toBeNull();
  });
});

/**
 * The transcript is memoised turn by turn (`TurnItem`), and a component under it that reads
 * `useShell()` or `useOptionalShell()` is woken by every shell render — every streamed frame —
 * straight through those memos. The code block's wrapper did, and every code block in the
 * thread rendered each frame. Anything under a message reads the shell by pick.
 */
describe('the transcript reads the shell by pick', () => {
  // Rendered around the rows, not inside them: they re-render with the workbench anyway.
  const OUTSIDE_ROWS = new Set(['conversation.tsx', 'greeting.tsx', 'starter-prompts.tsx']);
  const dirs = ['../src/components/chat', '../src/components/ai-elements'];

  it.each(dirs)('%s', (dir) => {
    const root = join(__dirname, dir);
    const offenders = readdirSync(root)
      .filter((f) => /\.tsx?$/.test(f) && !OUTSIDE_ROWS.has(f))
      .filter((f) => /\buse(Optional)?Shell\(\)/.test(readFileSync(join(root, f), 'utf8')));
    expect(offenders).toEqual([]);
  });
});
