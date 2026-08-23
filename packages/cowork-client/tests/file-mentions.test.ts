import { describe, expect, it } from 'vitest';
import { findFileMentions } from '../src/file-mentions';

const paths = (text: string) => findFileMentions(text).map((m) => m.path);

/**
 * The scanner is permissive by design — a false candidate costs nothing because
 * nothing renders until the filesystem confirms it, while a missed one is a link
 * the reader never gets. So the interesting half of this suite is what it
 * REFUSES: those are the shapes that would otherwise hit the resolver on every
 * message the agent writes.
 */
describe('what it finds', () => {
  it('finds a bare filename', () => {
    expect(paths('I rewrote check.js to be simpler.')).toEqual(['check.js']);
  });

  it('finds a relative path', () => {
    expect(paths('see notes/todo.md for the list')).toEqual(['notes/todo.md']);
  });

  it('finds a deep path', () => {
    expect(paths('edit apps/float/src/App.tsx now')).toEqual(['apps/float/src/App.tsx']);
  });

  it('finds an absolute path', () => {
    expect(paths('wrote /home/lars/foo.md')).toEqual(['/home/lars/foo.md']);
  });

  it('finds an unfamiliar extension', () => {
    expect(paths('run bb.jsh')).toEqual(['bb.jsh']);
  });

  it('finds known extensionless files', () => {
    expect(paths('check the Makefile and the Dockerfile')).toEqual(['Makefile', 'Dockerfile']);
  });

  it('finds several in one sentence', () => {
    expect(paths('a.ts and b.ts both changed')).toEqual(['a.ts', 'b.ts']);
  });

  it('finds names written in backticks', () => {
    expect(paths('the `vite.config.ts` file')).toEqual(['vite.config.ts']);
  });
});

describe('line suffixes', () => {
  it('splits a line number off the path', () => {
    const [m] = findFileMentions('see packages/ui/src/badge.tsx:42 for it');
    expect(m).toMatchObject({ path: 'packages/ui/src/badge.tsx', line: 42 });
    expect(m?.raw).toBe('packages/ui/src/badge.tsx:42');
  });

  it('accepts line:column and keeps the line', () => {
    expect(findFileMentions('App.tsx:42:7')[0]).toMatchObject({ path: 'App.tsx', line: 42 });
  });

  it('leaves a plain path without a line', () => {
    expect(findFileMentions('App.tsx')[0]?.line).toBeUndefined();
  });
});

describe('what it refuses', () => {
  it('refuses a word ending a sentence', () => {
    expect(paths('That is done.')).toEqual([]);
    expect(paths('Anything else? No.')).toEqual([]);
  });

  it('refuses abbreviations', () => {
    expect(paths('use a cache, e.g. redis')).toEqual([]);
    expect(paths('the loop, i.e. the retry')).toEqual([]);
  });

  it('refuses version numbers and decimals', () => {
    expect(paths('bumped to 1.2.3 today')).toEqual([]);
    expect(paths('about 3.14 seconds')).toEqual([]);
  });

  it('refuses bare hosts', () => {
    expect(paths('open example.com in a tab')).toEqual([]);
  });

  it('refuses a host with a path', () => {
    expect(paths('see docs.google.com/foo for it')).toEqual([]);
  });

  it('refuses URLs, including the filename inside them', () => {
    expect(paths('fetch https://example.com/app.js now')).toEqual([]);
    expect(paths('at http://localhost:5174/index.html')).toEqual([]);
  });

  it('refuses words that end in an extension-shaped English word', () => {
    expect(paths('it is built.in already')).toEqual([]);
    expect(paths('and so. Then we move on')).toEqual([]);
  });

  it('refuses ellipses and bare dots', () => {
    expect(paths('wait for it... then run')).toEqual([]);
    expect(paths('cd .. and back')).toEqual([]);
  });

  it('refuses a lone word with no extension', () => {
    expect(paths('the composer handles it')).toEqual([]);
  });

  // `.sh` is deliberately treated as an extension, not a TLD.
  it('keeps shell scripts', () => {
    expect(paths('run deploy.sh first')).toEqual(['deploy.sh']);
  });
});

describe('spans', () => {
  it('reports offsets that slice back to the raw text', () => {
    const text = 'edit notes/todo.md now';
    const [m] = findFileMentions(text);
    expect(m).toBeDefined();
    expect(text.slice(m!.start, m!.end)).toBe('notes/todo.md');
  });

  it('reports non-overlapping spans in source order', () => {
    const text = 'a.ts then b.ts then c.ts';
    const found = findFileMentions(text);
    expect(found.map((m) => text.slice(m.start, m.end))).toEqual(['a.ts', 'b.ts', 'c.ts']);
    for (let i = 1; i < found.length; i++) {
      expect(found[i]!.start).toBeGreaterThanOrEqual(found[i - 1]!.end);
    }
  });
});
