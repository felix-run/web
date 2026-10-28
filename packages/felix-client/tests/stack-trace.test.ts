import { describe, expect, it } from 'vitest';
import { parseStackTrace } from '../src/stack-trace';

/**
 * A stack trace at the end of a command's output. A miss leaves the stream as text; a false
 * positive dresses ordinary output up as a crash, so the refusals are pinned as hard as the reads.
 */

describe('CPython', () => {
  const tb = [
    'collected 3 items',
    'Traceback (most recent call last):',
    '  File "/work/app/main.py", line 12, in <module>',
    '    run()',
    '  File "/work/app/main.py", line 8, in run',
    '    total = parse(rows)',
    '            ^^^^^^^^^^^',
    '  File "/usr/lib/python3.12/site-packages/csvkit/parse.py", line 40, in parse',
    '    return int(value)',
    "ValueError: invalid literal for int() with base 10: 'x'",
  ].join('\n');

  it('reads the error and the frames, innermost first, with their source lines', () => {
    const t = parseStackTrace(tb);
    expect(t?.runtime).toBe('python');
    expect(t?.type).toBe('ValueError');
    expect(t?.message).toBe("invalid literal for int() with base 10: 'x'");
    expect(t?.frames.map((f) => [f.fn, f.line, f.library])).toEqual([
      ['parse', 40, true],
      ['run', 8, false],
      [null, 12, false],
    ]);
    // The caret line 3.11 draws is not the source.
    expect(t?.frames[1]?.source).toBe('total = parse(rows)');
  });

  it('reads the last traceback of a chained exception', () => {
    const chained = [
      'Traceback (most recent call last):',
      '  File "a.py", line 1, in f',
      'KeyError: 1',
      '',
      'During handling of the above exception, another exception occurred:',
      '',
      'Traceback (most recent call last):',
      '  File "b.py", line 2, in g',
      'RuntimeError: wrapped',
    ].join('\n');
    expect(parseStackTrace(chained)?.type).toBe('RuntimeError');
  });
});

describe('V8', () => {
  it('reads a Node stack, innermost first, marking runtime and package frames', () => {
    const out = [
      'TypeError: Cannot read properties of undefined (reading "id")',
      '    at rowId (/work/src/rows.ts:14:22)',
      '    at Array.map (<anonymous>)',
      '    at render (file:///work/src/page.ts:30:5)',
      '    at process.processTicksAndRejections (node:internal/process/task_queues:95:5)',
      '    at async run (/work/node_modules/vitest/dist/run.js:10:3)',
    ].join('\n');
    const t = parseStackTrace(out);
    expect(t?.runtime).toBe('node');
    expect(t?.type).toBe('TypeError');
    expect(t?.frames.map((f) => [f.fn, f.file, f.line, f.library])).toEqual([
      ['rowId', '/work/src/rows.ts', 14, false],
      ['render', '/work/src/page.ts', 30, false],
      ['process.processTicksAndRejections', 'node:internal/process/task_queues', 95, true],
      ['run', '/work/node_modules/vitest/dist/run.js', 10, true],
    ]);
  });
});

describe('not a stack trace', () => {
  it('refuses ordinary output, a lone frame, and a traceback with no error line', () => {
    expect(parseStackTrace('✓ 12 passed')).toBeNull();
    expect(parseStackTrace('Error: one thing\n    at only (a.js:1:1)')).toBeNull();
    expect(
      parseStackTrace('Traceback (most recent call last):\n  File "a.py", line 1, in f'),
    ).toBeNull();
    expect(parseStackTrace('look at this (a.js:1:1)')).toBeNull();
    expect(parseStackTrace(undefined)).toBeNull();
  });
});
