import { describe, expect, it } from 'bun:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPromptHistory, HISTORY_LIMIT, parseHistory } from '../src/history';

/**
 * Prompt recall, and the two ways a file of it goes wrong.
 *
 * It grows without bound, and it gets half-written when a terminal is closed
 * mid-run. Neither may cost the user the rest of the history, and neither may
 * stop the client from starting — this is a convenience file, and the only
 * failure mode worth having is "the arrow key does nothing".
 */

const dir = () => mkdtempSync(join(tmpdir(), 'felix-history-'));
const file = (d: string) => join(d, 'prompt-history.jsonl');

describe('parseHistory', () => {
  it('keeps the lines that parse and drops the ones that do not', () => {
    expect(parseHistory('"one"\n{ truncated\n"two"\n')).toEqual(['one', 'two']);
  });

  it('keeps only the newest entries', () => {
    const lines = Array.from({ length: HISTORY_LIMIT + 10 }, (_, i) => JSON.stringify(`p${i}`));
    const parsed = parseHistory(lines.join('\n'));
    expect(parsed).toHaveLength(HISTORY_LIMIT);
    expect(parsed[parsed.length - 1]).toBe(`p${HISTORY_LIMIT + 9}`);
  });

  it('drops a line that parses as something other than a prompt', () => {
    expect(parseHistory('"kept"\n42\nnull\n""\n')).toEqual(['kept']);
  });
});

describe('createPromptHistory', () => {
  it('reads back what was added, oldest first', () => {
    const d = dir();
    const history = createPromptHistory(d);
    history.add('first');
    history.add('second');
    expect(history.entries()).toEqual(['first', 'second']);
    expect(createPromptHistory(d).entries()).toEqual(['first', 'second']);
  });

  it('survives a prompt containing newlines', () => {
    const d = dir();
    createPromptHistory(d).add('line one\nline two');
    expect(createPromptHistory(d).entries()).toEqual(['line one\nline two']);
  });

  it('records a repeated prompt once', () => {
    const history = createPromptHistory(dir());
    history.add('again');
    history.add('again');
    history.add('  again  ');
    expect(history.entries()).toEqual(['again']);
  });

  it('records the same prompt twice when something came between', () => {
    const history = createPromptHistory(dir());
    history.add('a');
    history.add('b');
    history.add('a');
    expect(history.entries()).toEqual(['a', 'b', 'a']);
  });

  it('ignores an empty prompt', () => {
    const history = createPromptHistory(dir());
    history.add('   ');
    expect(history.entries()).toEqual([]);
  });

  it('caps the file, not just the list in memory', () => {
    const d = dir();
    const history = createPromptHistory(d);
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) history.add(`p${i}`);
    expect(history.entries()).toHaveLength(HISTORY_LIMIT);
    expect(readFileSync(file(d), 'utf8').trim().split('\n')).toHaveLength(HISTORY_LIMIT);
  });

  it('rewrites a corrupt file with whatever survived', () => {
    const d = dir();
    writeFileSync(file(d), '"kept"\n{ half a line');
    expect(createPromptHistory(d).entries()).toEqual(['kept']);
    expect(readFileSync(file(d), 'utf8')).toBe('"kept"\n');
  });

  it('leaves an already-clean file alone', () => {
    const d = dir();
    createPromptHistory(d).add('one');
    const before = readFileSync(file(d), 'utf8');
    createPromptHistory(d);
    expect(readFileSync(file(d), 'utf8')).toBe(before);
  });

  it('starts empty rather than throwing when the state directory cannot be read', () => {
    const history = createPromptHistory(join(dir(), 'missing', 'deeper'));
    expect(history.entries()).toEqual([]);
    expect(() => history.add('still works')).not.toThrow();
  });
});
