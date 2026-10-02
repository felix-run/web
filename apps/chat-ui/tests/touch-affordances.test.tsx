/** @vitest-environment happy-dom */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { MessageActions } from '../src/components/chat/message-actions';

/**
 * Two touch rules that compile, lint and render identically at a desk, and so can
 * only be broken without anyone noticing.
 *
 * A turn's actions were hidden until hover on anything `sm:` and wider — every
 * iPad — where a tap does not reliably produce a hover. And iOS zooms the page
 * when a field under 16px takes focus, which most fields here are. happy-dom
 * evaluates neither media query, so what is pinned is the shape of each rule.
 */

afterEach(cleanup);

describe('hover-revealed actions', () => {
  it('hide only where the device can hover, never by width', () => {
    render(
      <TooltipProvider>
        <MessageActions content="the answer" />
      </TooltipProvider>,
    );
    const row = screen.getByRole('button', { name: 'Copy message' }).closest('div.flex');
    const classes = (row?.className ?? '').split(/\s+/);
    expect(classes).toContain('[@media(hover:hover)]:opacity-0');
    expect(classes.some((c) => /^(sm|md|lg):opacity-0$/.test(c))).toBe(false);
  });
});

describe('fields on a touch screen', () => {
  // `import.meta.url` is not a file URL once the test is transformed.
  const css = readFileSync(join(process.cwd(), 'src/index.css'), 'utf8');

  it('are 16px, from a rule outside every @layer so no text utility outranks it', () => {
    const at = css.indexOf('@media (pointer: coarse) {');
    expect(at).toBeGreaterThan(-1);
    const block = css.slice(at, css.indexOf('\n}\n', at));
    expect(block).toMatch(/textarea/);
    expect(block).toMatch(/font-size:\s*16px/);
    // Brace depth at the rule is 0: inside a layer, `text-sm` would win.
    let depth = 0;
    for (const ch of css.slice(0, at).replace(/\/\*[\s\S]*?\*\//g, '')) {
      if (ch === '{') depth++;
      else if (ch === '}') depth--;
    }
    expect(depth).toBe(0);
  });
});
