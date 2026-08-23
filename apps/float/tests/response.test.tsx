/**
 * @vitest-environment happy-dom
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Response } from '@/components/chat/response';

/**
 * float rendered assistant output as `<pre>` until now, which made these
 * questions moot. Rendering markup instead means the renderer is a trust
 * boundary, so the dangerous shapes are asserted rather than assumed.
 */
describe('Response sanitization', () => {
  it('renders ordinary markdown as markup, not as literal syntax', async () => {
    const { container } = render(<Response>{'# Title\n\nSome **bold** text.'}</Response>);
    expect(await screen.findByText('Title')).toBeTruthy();
    expect(container.querySelector('h1')?.textContent).toBe('Title');
    // The emphasis wrapper element is Streamdown's business; that the markdown
    // was parsed rather than shown verbatim is what this pins.
    expect(container.textContent).toContain('bold');
    expect(container.textContent).not.toContain('**');
  });

  it('does not execute or emit a script tag', async () => {
    const { container } = render(
      <Response>{'before\n\n<script>globalThis.__pwned = true;</script>\n\nafter'}</Response>,
    );
    await screen.findByText(/before/);
    expect(container.querySelector('script')).toBeNull();
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
  });

  it('strips inline event handlers', async () => {
    const { container } = render(<Response>{'<div onclick="globalThis.__x=1">hi</div>'}</Response>);
    await screen.findByText('hi');
    expect(container.innerHTML).not.toContain('onclick');
  });

  // Rendered as a plain, visibly-marked span rather than an anchor at all.
  it('refuses a javascript: href instead of emitting a live link', async () => {
    const { container } = render(<Response>{'[click](javascript:globalThis.__x=1)'}</Response>);
    await screen.findByText(/click/);
    expect(container.querySelector('a')).toBeNull();
    expect(container.textContent).toContain('blocked');
    expect(container.innerHTML.toLowerCase()).not.toContain('javascript:');
  });

  it('does not emit an iframe', async () => {
    const { container } = render(
      <Response>{'<iframe src="https://example.com"></iframe>\n\ntext'}</Response>,
    );
    await screen.findByText('text');
    expect(container.querySelector('iframe')).toBeNull();
  });
});
