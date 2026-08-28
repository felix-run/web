import { describe, expect, it } from 'vitest';
import { renderText, splitBlocks } from '../src/markdown';

/**
 * A reply is markdown, and it arrives a character at a time. The state that
 * matters is the one halfway through a fence: dropping an unterminated block, or
 * treating its contents as prose, makes streamed code unreadable exactly while
 * it is being written.
 */

describe('splitBlocks', () => {
  it('separates fenced code from prose and keeps the language', () => {
    expect(splitBlocks('before\n```ts\nconst a = 1;\n```\nafter')).toEqual([
      { kind: 'text', text: 'before' },
      { kind: 'code', text: 'const a = 1;', lang: 'ts' },
      { kind: 'text', text: 'after' },
    ]);
  });

  it('keeps a fence that has not closed yet as code', () => {
    expect(splitBlocks('here:\n```py\nprint(')).toEqual([
      { kind: 'text', text: 'here:' },
      { kind: 'code', text: 'print(', lang: 'py' },
    ]);
  });

  it('leaves plain prose as one block', () => {
    expect(splitBlocks('just words')).toEqual([{ kind: 'text', text: 'just words' }]);
  });
});

describe('renderText', () => {
  it('turns list markers into ones that align', () => {
    expect(renderText('- one\n- two')).toBe('• one\n• two');
  });

  it('keeps ordered lists numbered', () => {
    expect(renderText('1. first\n2. second')).toBe('1. first\n2. second');
  });

  it('drops heading hashes and inline markers that nothing will render', () => {
    expect(renderText('## Title')).toBe('Title');
    expect(renderText('a **bold** and `code` word')).toBe('a bold and code word');
  });

  it('keeps a link readable as text plus target', () => {
    expect(renderText('see [the docs](https://x/y)')).toBe('see the docs (https://x/y)');
  });
});
