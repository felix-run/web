// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { DiffView } from '../src/components/skills/diff-view';
import { diffChunks, diffLines, MAX_DIFF_CELLS } from '../src/lib/diff';

/**
 * The skill diff, the evidence every publish and every merge choice is made
 * from. Two properties matter more than prettiness: the diff must be *correct*
 * (a line reported unchanged that changed is a reviewer approving something
 * they were not shown), and it must say when it is not a minimal diff rather
 * than pass a block swap off as one.
 */

afterEach(cleanup);

const lines = (n: number, prefix = 'line') =>
  Array.from({ length: n }, (_, i) => `${prefix} ${i + 1}`);

describe('diffLines', () => {
  it('reports one changed line as one removed and one added, numbered on both sides', () => {
    const d = diffLines('a\nb\nc', 'a\nB\nc');
    expect(d.lines).toEqual([
      { type: 'same', line: 'a', oldNo: 1, newNo: 1 },
      { type: 'remove', line: 'b', oldNo: 2 },
      { type: 'add', line: 'B', newNo: 2 },
      { type: 'same', line: 'c', oldNo: 3, newNo: 3 },
    ]);
    expect([d.added, d.removed, d.exact]).toEqual([1, 1, true]);
  });

  it('handles an empty side as all-added or all-removed', () => {
    expect(diffLines('', 'x\ny')).toMatchObject({ added: 2, removed: 0 });
    expect(diffLines('x\ny', '')).toMatchObject({ added: 0, removed: 2 });
    expect(diffLines('', '')).toMatchObject({ added: 0, removed: 0, lines: [] });
  });

  it('finds a minimal diff for an insertion inside repeated lines', () => {
    const d = diffLines('x\nx\nx', 'x\nx\ny\nx');
    expect([d.added, d.removed]).toEqual([1, 0]);
  });

  it('reconstructs both texts exactly from the lines it reports', () => {
    const before = ['# T', 'one', 'two', 'three', 'four', 'five'].join('\n');
    const after = ['# T', 'zero', 'one', 'three', 'four!', 'five', 'six'].join('\n');
    const d = diffLines(before, after);
    const old = d.lines.filter((l) => l.type !== 'add').map((l) => l.line);
    const now = d.lines.filter((l) => l.type !== 'remove').map((l) => l.line);
    expect(old.join('\n')).toBe(before);
    expect(now.join('\n')).toBe(after);
  });

  it('trims the shared head and tail, so a long file with one edit stays exact', () => {
    const big = lines(10_000);
    const edited = [...big];
    edited[5_000] = 'changed';
    const d = diffLines(big.join('\n'), edited.join('\n'));
    expect(d.exact).toBe(true);
    expect([d.added, d.removed]).toEqual([1, 1]);
  });

  it('says so when the changed middle is too large to align', () => {
    const n = Math.ceil(Math.sqrt(MAX_DIFF_CELLS)) + 10;
    const d = diffLines(lines(n, 'a').join('\n'), lines(n, 'b').join('\n'));
    expect(d.exact).toBe(false);
    expect([d.added, d.removed]).toEqual([n, n]);
  });
});

describe('diffChunks', () => {
  it('keeps context around a change and folds the rest, keeping the folded lines', () => {
    const before = lines(20).join('\n');
    const after = lines(20)
      .map((l, i) => (i === 10 ? 'changed' : l))
      .join('\n');
    const chunks = diffChunks(diffLines(before, after).lines, 2);
    expect(chunks.map((c) => c.kind)).toEqual(['fold', 'lines', 'fold']);
    const [head, mid, tail] = chunks;
    expect(head?.kind === 'fold' && head.count).toBe(8);
    expect(mid?.kind === 'lines' && mid.lines).toHaveLength(6);
    expect(tail?.kind === 'fold' && tail.lines.map((l) => l.line)[0]).toBe('line 14');
  });
});

describe('<DiffView>', () => {
  it('names both sides and counts the change in words, not only colour', () => {
    render(<DiffView before={'a\nb'} after={'a\nc'} beforeLabel="0.1.0" afterLabel="0.1.1" />);
    expect(screen.getByText(/0\.1\.0/).textContent).toContain('0.1.1');
    expect(document.body.textContent).toContain('+1');
    expect(document.body.textContent).toContain('added');
    expect(document.body.textContent).toContain('removed');
    // Each changed row carries its sign and a spoken word, so the state survives
    // without colour.
    const rows = [...document.querySelectorAll('tbody tr')].map((r) => r.textContent ?? '');
    expect(rows.some((r) => r.includes('removed') && r.includes('b'))).toBe(true);
    expect(rows.some((r) => r.includes('added') && r.includes('c'))).toBe(true);
  });

  it('says there is no difference rather than drawing an empty table', () => {
    render(<DiffView before="same" after="same" beforeLabel="a" afterLabel="b" />);
    expect(screen.getByText('No differences')).toBeTruthy();
    expect(document.querySelector('table')).toBeNull();
  });

  it('opens a fold to show the unchanged lines it stood for', () => {
    const before = lines(30).join('\n');
    const after = `${before}\nnew`;
    render(<DiffView before={before} after={after} beforeLabel="a" afterLabel="b" context={1} />);
    expect(document.body.textContent).not.toContain('line 5');
    fireEvent.click(screen.getByRole('button', { name: '29 unchanged lines' }));
    expect(document.body.textContent).toContain('line 5');
  });

  it('draws agent-written text as text', () => {
    render(
      <DiffView
        before=""
        after={'<img src=x onerror="alert(1)">'}
        beforeLabel="a"
        afterLabel="b"
      />,
    );
    expect(document.querySelector('img')).toBeNull();
    expect(document.body.textContent).toContain('<img src=x');
  });
});
