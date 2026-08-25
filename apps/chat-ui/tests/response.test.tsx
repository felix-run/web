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
