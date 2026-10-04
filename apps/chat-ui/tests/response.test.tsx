/** @vitest-environment happy-dom */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Response } from '../src/components/chat/response';

/**
 * `Response` renders assistant markdown through a third-party renderer, and the parts
 * of that rendering the app has an opinion about are styled two different ways. Lists
 * it owns outright, by overriding the components; the code block's chrome it cannot,
 * because owning `pre` would mean giving up syntax highlighting, so those rules stay in
 * `index.css` and aim at the renderer's `data-streamdown` attributes.
 *
 * The second kind is the one that can rot in silence: a selector aimed at someone else's
 * markup keeps compiling after that markup moves, matches nothing, and fails nothing.
 * The last test reads the selectors out of the stylesheet rather than restating them, so
 * it keeps covering whatever is there rather than a list that drifts from it.
 */

afterEach(cleanup);

describe('Response lists', () => {
  it('hangs a wrapped line under the text, not under its own marker', () => {
    const { container } = render(<Response>{'- a bullet\n'}</Response>);
    const ul = container.querySelector('ul');
    // Markers outside with padding for them to sit in: the padding is the alignment
    // a wrapped line falls back to.
    expect(ul?.className).toContain('list-outside');
    expect(ul?.className).toContain('pl-6');
  });

  it('nests a child list inside its parent item, where it gets its own indent', () => {
    const { container } = render(<Response>{'- parent\n  - child\n'}</Response>);
    const nested = container.querySelector('li > ul');
    expect(nested).not.toBeNull();
    expect(nested?.className).toContain('pl-6');
  });

  it('drops the marker on a task item, because the checkbox is the marker', () => {
    const { container } = render(<Response>{'- [x] done\n- [ ] todo\n'}</Response>);
    const items = container.querySelectorAll('li.task-list-item');
    expect(items).toHaveLength(2);
    for (const item of items) expect(item.className).toContain('list-none');
  });

  it('leaves a plain item its marker', () => {
    const { container } = render(<Response>{'- plain\n'}</Response>);
    expect(container.querySelector('li')?.className).not.toContain('list-none');
  });

  it('keeps a caller-supplied class on the root', () => {
    const { container } = render(<Response className="mt-4">{'hello'}</Response>);
    expect(container.querySelector('.mt-4')).not.toBeNull();
  });
});

describe('Response headings', () => {
  const sizes = (el: Element | null) =>
    (el?.className ?? '').split(/\s+/).filter((c) => /^text-(xs|sm|base|lg|[2-9]?xl)$/.test(c));

  it('never sets a heading above the 16px body — the welcome is the one display element', () => {
    const { container } = render(
      <Response>{'# One\n\n## Two\n\n### Three\n\n#### Four\n\n###### Six\n\nBody.'}</Response>,
    );
    for (const level of [1, 2, 3]) {
      expect(sizes(container.querySelector(`h${level}`))).toEqual(['text-base']);
    }
    for (const level of [4, 6]) {
      expect(sizes(container.querySelector(`h${level}`))).toEqual(['text-sm']);
    }
  });
});

describe('Response line breaks', () => {
  it('breaks a line where the model put a newline', () => {
    // A haiku is the shortest thing that proves it: three lines, two bare newlines,
    // and CommonMark renders all three as one sentence without this.
    const { container } = render(
      <Response>
        {'Words flow one by one,\nDigital thoughts take their shape\nMeaning emerges.'}
      </Response>,
    );
    expect(container.querySelectorAll('p br')).toHaveLength(2);
  });

  it('leaves a blank line as a paragraph break, not a line break', () => {
    // The softbreak fix must not pull a hard break into one paragraph.
    const { container } = render(<Response>{'first\n\nsecond'}</Response>);
    expect(container.querySelectorAll('p')).toHaveLength(2);
    expect(container.querySelectorAll('br')).toHaveLength(0);
  });
});

/**
 * `remarkPlugins` replaces the renderer's own list rather than merging with it, so the
 * moment this file passes one, every default becomes this file's problem. These are the
 * two that would go quietly: a table still parses, and `~~text~~` is still struck
 * through. Both come from `remark-gfm`, which a one-plugin array would have dropped
 * while every other test here kept passing.
 */
describe('the renderer keeps its own plugins', () => {
  it('still parses a GFM table', () => {
    const { container } = render(<Response>{'| a | b |\n| - | - |\n| 1 | 2 |\n'}</Response>);
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelectorAll('td')).toHaveLength(2);
  });

  it('still parses GFM strikethrough', () => {
    const { container } = render(<Response>{'~~gone~~'}</Response>);
    expect(container.querySelector('del')).not.toBeNull();
  });
});

/**
 * Every selector in `index.css` that reaches into the renderer's own markup, with any
 * pseudo-element trimmed off so it can be queried.
 */
function styledSelectors(): string[] {
  // cwd is the package root under vitest, from the workspace root or from here.
  // `import.meta.url` is not a file URL once the test is transformed, so it cannot be used.
  const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');
  return [...css.matchAll(/^(\[data-streamdown[^{]*)\{/gm)]
    .map((m) => m[1].trim().replace(/::[a-z-]+\b/g, ''))
    .map((s) => s.trim());
}

describe('the stylesheet still reaches the renderer', () => {
  it('has selectors to check', () => {
    // Guards the guard: a regex that stops matching would leave this suite asserting
    // nothing, which reads exactly like a pass.
    expect(styledSelectors().length).toBeGreaterThan(0);
  });

  it('matches every code-block selector it styles', async () => {
    const { container } = render(<Response>{'```python\nx = 1\n```\n'}</Response>);
    // Highlighting resolves after a tick; the chrome is there from the first paint.
    await waitFor(() => expect(container.querySelector('[data-streamdown]')).not.toBeNull());

    for (const selector of styledSelectors()) {
      expect(container.querySelector(selector), `${selector} matched nothing`).not.toBeNull();
    }
  });
});

/**
 * The other half of the long-token fix. Prose wraps with `break-word`, which leaves
 * words whole when a box is sized — so a table or a code block keeps its natural width
 * and scrolls inside the renderer's own `overflow-x-auto` box instead of widening the
 * transcript. `anywhere` here would squeeze a table's columns to a letter each. These
 * pin both halves of that arrangement, since the second is the renderer's markup and
 * would not announce a change.
 */
describe('long content stays inside its own box', () => {
  it('wraps prose without letting a table collapse its columns', () => {
    const { container } = render(<Response>{'x'}</Response>);
    const root = container.firstElementChild;
    expect(root?.className).toContain('wrap-break-word');
    expect(root?.className).not.toContain('wrap-anywhere');
  });

  it('scrolls a table sideways inside its wrapper', () => {
    const { container } = render(<Response>{'| a | b |\n| - | - |\n| 1 | 2 |\n'}</Response>);
    expect(container.querySelector('table')?.parentElement?.className).toContain('overflow-x-auto');
  });

  it('scrolls a code block sideways inside its own body', async () => {
    const { container } = render(<Response>{'```text\nx\n```\n'}</Response>);
    await waitFor(() =>
      expect(container.querySelector('[data-streamdown="code-block-body"]')).not.toBeNull(),
    );
    expect(container.querySelector('[data-streamdown="code-block-body"]')?.className).toContain(
      'overflow-x-auto',
    );
  });
});

/**
 * Math is rendered by a KaTeX that loads with the first reply needing it, and
 * runs *after* the sanitizer (`lib/katex-plugin.ts`). Before that reorder the
 * sanitizer scrubbed KaTeX's output, and a formula drew as MathML, TeX source and
 * glyphs run together — so what is pinned is KaTeX's real markup, not merely
 * that a `π` appeared somewhere, plus the two things the reorder must not cost:
 * the model's own HTML is still sanitized, and a formula cannot carry a link.
 */
describe('math in a reply', () => {
  it('renders `$$` math as KaTeX markup, inline as well as on its own line', async () => {
    // Inline is also the remount case: streamdown's memo ignores a new plugin
    // list, so without it the math stayed as `code.language-math`.
    for (const [md, display] of [
      ['Area: $$\\pi r^2$$', false],
      ['$$\n\\pi r^2\n$$', true],
    ] as const) {
      const { container, unmount } = render(<Response>{md}</Response>);
      await waitFor(() => expect(container.querySelector('.katex')).not.toBeNull());
      expect(container.querySelector('code.language-math')).toBeNull();
      // The MathML is kept for assistive tech and hidden by KaTeX's CSS through
      // this class; without it the formula is read and drawn twice.
      expect(container.querySelector('.katex-mathml math')).not.toBeNull();
      expect(container.querySelector('.katex-html')?.textContent).toContain('π');
      expect(container.querySelector('.katex-display') !== null).toBe(display);
      unmount();
    }
  });

  it('still sanitizes the rest of a reply that has math in it', async () => {
    const { container } = render(
      <Response>
        {'$$x$$ <img src="x" onerror="alert(1)"> <span style="color:red">hi</span>'}
      </Response>,
    );
    await waitFor(() => expect(container.querySelector('.katex')).not.toBeNull());
    expect(container.innerHTML).not.toContain('onerror');
    expect(container.innerHTML).not.toContain('color:red');
  });

  it('refuses a link inside a formula — KaTeX keeps `trust` off', async () => {
    const { container } = render(<Response>{'$$\\href{javascript:alert(1)}{click}$$'}</Response>);
    await waitFor(() => expect(container.querySelector('.katex, .katex-error')).not.toBeNull());
    expect(container.querySelector('a')).toBeNull();
    // The source survives as *text* — KaTeX draws a refused command in the error
    // colour, and the MathML annotation keeps the TeX — but never as a value an
    // element acts on.
    const attributes = [...container.querySelectorAll('*')].flatMap((el) =>
      [...el.attributes].map((a) => a.value),
    );
    expect(attributes.some((v) => v.includes('javascript:'))).toBe(false);
    expect(container.querySelector('.katex-html')?.textContent).toContain('\\href');
  });

  it('loads KaTeX’s stylesheet itself, with the plugin', () => {
    // Read from the source because a test cannot see it work: CSS imports are
    // stubbed here, and the failure only ever showed in a production build,
    // where streamdown's own request for this file is never made. Without it
    // nothing hides the MathML and every formula is followed by a copy of
    // itself as plain text.
    const source = readFileSync(join(__dirname, '../src/lib/katex-plugin.ts'), 'utf8');
    expect(source).toMatch(
      /Promise\.all\(\[\s*import\('rehype-katex'\),\s*import\('katex\/dist\/katex\.min\.css'\)/,
    );
  });

  it('runs KaTeX straight after sanitize, and keeps every other plugin in streamdown’s order', async () => {
    const { defaultRehypePlugins } = await import('streamdown');
    const { WITHOUT_MATH, loadMathPlugins } = await import('../src/lib/katex-plugin');
    const { katex: _katex, ...rest } = defaultRehypePlugins;
    expect(WITHOUT_MATH).toEqual(Object.values(rest));
    const withMath = await loadMathPlugins();
    const isKatex = (p: unknown) =>
      Array.isArray(p) && (p[0] as { name?: string }).name === 'rehypeKatex';
    expect(withMath.filter(isKatex)).toHaveLength(1);
    expect(withMath.filter((p) => !isKatex(p))).toEqual(Object.values(rest));
    expect(withMath.findIndex(isKatex)).toBe(Object.keys(rest).indexOf('sanitize') + 1);
  });
});
