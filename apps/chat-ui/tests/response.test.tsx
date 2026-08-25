/** @vitest-environment happy-dom */
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Response } from '../src/components/chat/response';

/**
 * `Response` renders assistant markdown, and the list styling it ships with lives in
 * `index.css` under `.felix-markdown` — a class with no utilities of its own, whose only
 * job is to be the handle those rules reach through.
 *
 * That coupling is invisible from both ends. Delete the class here and the rules still
 * compile and simply stop matching; long bullets go back to wrapping under their own
 * marker and nested lists go flat, which is a rendering change with nothing failing to
 * announce it. The stylesheet cannot be asserted from happy-dom — no CSS is loaded — so
 * what is pinned is the half that lives in the component: the handle exists, and the
 * markup the rules are written against is the markup that comes out.
 */

afterEach(cleanup);

describe('Response', () => {
  it('carries the styling hook index.css targets', () => {
    const { container } = render(<Response>{'hello'}</Response>);
    expect(container.querySelector('.felix-markdown')).not.toBeNull();
  });

  it('keeps a caller-supplied class alongside it', () => {
    const { container } = render(<Response className="mt-4">{'hello'}</Response>);
    const root = container.querySelector('.felix-markdown');
    expect(root?.className).toContain('mt-4');
  });

  it('nests a child list inside its parent item, which is what the indent rule reads', () => {
    const { container } = render(<Response>{'- parent\n  - child\n'}</Response>);
    expect(container.querySelector('li > ul')).not.toBeNull();
  });

  it('marks task items with the class the marker rule reads', () => {
    const { container } = render(<Response>{'- [x] done\n- [ ] todo\n'}</Response>);
    const items = container.querySelectorAll('li.task-list-item');
    expect(items).toHaveLength(2);
    expect(container.querySelectorAll('li.task-list-item > input[type="checkbox"]')).toHaveLength(
      2,
    );
  });
});
