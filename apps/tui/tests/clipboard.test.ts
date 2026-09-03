import { describe, expect, it } from 'bun:test';
import { type ClipboardTarget, copyText, describeCopy } from '../src/clipboard';

/**
 * Copying out of an alt-screen client.
 *
 * The four outcomes are kept apart because they mean different things to the
 * person: an empty selection is not an event, a terminal that never claimed to
 * support OSC 52 is a fact about their setup, and a terminal that claimed to and
 * then refused is a failure worth reporting.
 */

const terminal = (
  opts: { supported?: boolean; accepts?: boolean } = {},
): ClipboardTarget & {
  wrote: string[];
} => {
  const wrote: string[] = [];
  return {
    wrote,
    isOsc52Supported: () => opts.supported ?? true,
    copyToClipboardOSC52: (text: string) => {
      wrote.push(text);
      return opts.accepts ?? true;
    },
  };
};

describe('copyText', () => {
  it('copies what was selected, unchanged', () => {
    const t = terminal();
    expect(copyText(t, 'const a = 1;\nconst b = 2;')).toEqual({
      status: 'copied',
      characters: 25,
    });
    expect(t.wrote).toEqual(['const a = 1;\nconst b = 2;']);
  });

  /**
   * Trailing whitespace is what a drag past the end of a line produces, and it
   * is not a selection. Note it is only the *emptiness* test that trims — what
   * gets copied keeps its own whitespace, because indentation in a copied code
   * block is the point.
   */
  it('treats a whitespace-only selection as nothing at all', () => {
    const t = terminal();
    expect(copyText(t, '   \n  ')).toEqual({ status: 'empty' });
    expect(t.wrote).toEqual([]);
  });

  it('keeps the leading indentation of a real selection', () => {
    const t = terminal();
    copyText(t, '    indented();\n');
    expect(t.wrote[0]).toBe('    indented();\n');
  });

  it('does not write to a terminal that does not accept clipboard writes', () => {
    const t = terminal({ supported: false });
    expect(copyText(t, 'hello')).toEqual({ status: 'unsupported' });
    expect(t.wrote).toEqual([]);
  });

  it('reports a terminal that accepted the sequence and then refused it', () => {
    const t = terminal({ accepts: false });
    expect(copyText(t, 'hello')).toEqual({ status: 'failed' });
  });
});

describe('describeCopy', () => {
  it('says nothing about an empty selection', () => {
    expect(describeCopy({ status: 'empty' })).toBeNull();
  });

  it('counts characters, and gets the singular right', () => {
    expect(describeCopy({ status: 'copied', characters: 1 })).toBe('copied 1 character');
    expect(describeCopy({ status: 'copied', characters: 42 })).toBe('copied 42 characters');
  });

  it('distinguishes a terminal that cannot from one that would not', () => {
    expect(describeCopy({ status: 'unsupported' })).toContain('OSC 52');
    expect(describeCopy({ status: 'failed' })).toContain('refused');
  });
});
