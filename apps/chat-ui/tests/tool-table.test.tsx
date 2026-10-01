// @vitest-environment happy-dom
import { act, render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { Tool } from '../src/components/chat/tool';
import type { ToolCall } from '../src/types';

/**
 * A tool result that is a table is drawn as one, and only then: a failure stays
 * words, a shell result keeps its own layout, and the raw text is one click away.
 */

const call = (output: unknown, name = 'query_db'): ToolCall => ({
  name,
  input: { sql: 'select 1' },
  output,
  done: true,
});

/** Verbose expands the card, which is how its contents are on screen to assert on. */
const mount = (tool: ToolCall) => render(<Tool tool={tool} verbose />);

afterEach(() => {
  document.body.innerHTML = '';
});

describe('a tabular result', () => {
  it('draws rows under their column names, and the raw text on request', async () => {
    mount(call('[{"id":1,"name":"ann"},{"id":2,"name":"bo"}]'));

    const headers = [...document.querySelectorAll('th')].map((th) => th.textContent);
    expect(headers).toEqual(['id', 'name']);
    expect([...document.querySelectorAll('tbody tr')].map((tr) => tr.textContent)).toEqual([
      '1ann',
      '2bo',
    ]);
    expect(document.body.textContent).toContain('2 rows · JSON');

    const raw = [...document.querySelectorAll('button')].find((b) => b.textContent === 'raw')!;
    await act(async () => void (await userEvent.click(raw)));
    expect(document.querySelector('table')).toBeNull();
    expect(document.body.textContent).toContain('"name": "ann"');
  });

  it('says how many rows it is not drawing', () => {
    const rows = Array.from({ length: 130 }, (_, i) => ({ n: i, sq: i * i }));
    mount(call(JSON.stringify(rows)));
    expect(document.querySelectorAll('tbody tr')).toHaveLength(100);
    expect(document.body.textContent).toContain('30 more rows');
  });
});

describe('what stays as it was', () => {
  it('leaves a failed call as its error, even when the text would parse', () => {
    mount(call('[tool error/timeout] a,b\n1,2\n3,4'));
    expect(document.querySelector('table')).toBeNull();
  });

  it('leaves prose as text', () => {
    mount(
      call(
        'I looked in the config, the env file, and the README.\nNothing there, sadly.\nDone, then.',
      ),
    );
    expect(document.querySelector('table')).toBeNull();
    expect(document.body.textContent).toContain('I looked in the config');
  });
});
