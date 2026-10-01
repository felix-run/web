import { describe, expect, it } from 'vitest';
import { parseTabular } from '../src/tabular';

/**
 * Recognising a table in tool output. A miss leaves output as text, which is
 * what it was; a false positive mangles output that was fine. So the refusals
 * matter as much as the matches.
 */

describe('JSON', () => {
  it('reads an array of records, columns in first-seen order', () => {
    const t = parseTabular('[{"id":1,"name":"a"},{"id":2,"name":"b","tag":"x"}]');
    expect(t).toEqual({
      columns: ['id', 'name', 'tag'],
      rows: [
        ['1', 'a', ''],
        ['2', 'b', 'x'],
      ],
      source: 'json',
    });
  });

  it('unwraps the common envelopes, and takes already-parsed values', () => {
    expect(
      parseTabular({
        items: [
          { a: 1, b: 2 },
          { a: 3, b: 4 },
        ],
        next: null,
      })?.rows,
    ).toEqual([
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('refuses one record, one column, and documents of nested objects', () => {
    expect(parseTabular('[{"a":1,"b":2}]')).toBeNull();
    expect(parseTabular('[{"a":1},{"a":2}]')).toBeNull();
    expect(
      parseTabular([
        { a: { x: 1 }, b: { y: 2 } },
        { a: { x: 3 }, b: { y: 4 } },
      ]),
    ).toBeNull();
    expect(parseTabular('[1,2,3]')).toBeNull();
    expect(
      parseTabular('{"name":"x","items":[{"a":1,"b":2},{"a":3,"b":4}],"x":1,"y":2,"z":3}'),
    ).toBeNull();
  });
});

describe('delimited text', () => {
  it('reads CSV with quoted fields and escaped quotes', () => {
    const t = parseTabular('name,note\nann,"says ""hi"", twice"\nbo,plain\n');
    expect(t?.source).toBe('csv');
    expect(t?.rows).toEqual([
      ['ann', 'says "hi", twice'],
      ['bo', 'plain'],
    ]);
  });

  it('prefers tabs when the header has them', () => {
    expect(parseTabular('a\tb\n1\t2\n3\t4')?.source).toBe('tsv');
  });

  it('refuses prose that happens to contain commas', () => {
    const prose =
      'I checked the config, the env file, and the README.\nNothing there, so I looked elsewhere, twice.\nStill nothing, sadly, at all.';
    expect(parseTabular(prose)).toBeNull();
  });

  it('refuses ragged rows and too few lines', () => {
    expect(parseTabular('a,b\n1,2\n3')).toBeNull();
    expect(parseTabular('a,b\n1,2')).toBeNull();
    expect(parseTabular('just a line')).toBeNull();
  });
});
