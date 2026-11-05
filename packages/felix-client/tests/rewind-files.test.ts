import { describe, expect, it } from 'vitest';
import { describeRestoredFiles, recordedFileChanges } from '../src/rewind-files';
import type { Turn } from '../src/turns';

const turn = (tools: NonNullable<Turn['tools']>): Turn => ({
  id: 't',
  role: 'assistant',
  content: '',
  tools,
});
const write = (path: string, output: unknown = 'ok') => ({
  name: 'write_file',
  input: { path },
  output,
  done: true,
});

describe('what a rewind has to ask about', () => {
  it('counts files, not calls', () => {
    expect(recordedFileChanges([turn([write('a'), write('a')]), turn([write('b')])])).toBe(2);
  });

  it('ignores what the harness never recorded, and what never happened', () => {
    expect(
      recordedFileChanges([
        turn([
          { name: 'local_write', input: { path: 'a' }, output: 'ok', done: true },
          { name: 'read_file', input: { path: 'a' }, output: 'x', done: true },
          { name: 'write_file', input: { path: 'b' }, done: false },
          write('c', '[tool error/permission_denied] no'),
          write('d', '[approval denied] tool=write_file rule=r'),
        ]),
      ]),
    ).toBe(0);
  });
});

describe('the restore in words', () => {
  it('says what was done, with nothing to act on', () => {
    expect(describeRestoredFiles({ restored: ['a', 'b'], removed: ['c'] })).toEqual({
      done: 'Put back 2 files, removed 1 new file.',
      problem: null,
    });
  });

  it('keeps what was left alone apart, and names it', () => {
    const { problem } = describeRestoredFiles({
      restored: ['a'],
      conflicts: ['README.md'],
      skipped: ['big.bin'],
      truncated: true,
    });
    expect(problem).toContain('changed since: README.md');
    expect(problem).toContain('not kept: big.bin');
    expect(problem).toContain('too much');
  });

  it('says a failed restore moved no file, and that a later rewind still can', () => {
    expect(describeRestoredFiles({ error: 'unavailable' })).toEqual({
      done: 'No files were put back.',
      problem: expect.stringContaining('a later rewind can'),
    });
  });

  it('cuts a long list', () => {
    const conflicts = ['1', '2', '3', '4', '5', '6', '7'];
    expect(describeRestoredFiles({ conflicts }).problem).toContain('and 2 more');
  });
});
