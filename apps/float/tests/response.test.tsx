/**
 * @vitest-environment happy-dom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Response } from '@/components/chat/response';

// This config does not set `globals`, so testing-library's automatic cleanup
// never registers and renders would otherwise pile up in one document.
afterEach(cleanup);

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

describe('file mentions', () => {
  const mentions = new Map([
    ['notes/todo.md', 'notes/todo.md'],
    ['App.tsx', 'apps/float/src/App.tsx'],
  ]);

  it('leaves everything plain when nothing is confirmed', async () => {
    const { container } = render(<Response mentions={new Map()}>{'see notes/todo.md'}</Response>);
    await screen.findByText(/notes\/todo\.md/);
    expect(container.querySelector('button')).toBeNull();
  });

  it('turns a confirmed mention into a button', async () => {
    const onOpenFile = vi.fn();
    render(
      <Response mentions={mentions} onOpenFile={onOpenFile}>
        {'I wrote notes/todo.md for you'}
      </Response>,
    );
    const button = await screen.findByRole('button', { name: 'notes/todo.md' });
    button.click();
    expect(onOpenFile).toHaveBeenCalledWith('notes/todo.md', undefined);
  });

  it('passes the line number through', async () => {
    const onOpenFile = vi.fn();
    render(
      <Response mentions={mentions} onOpenFile={onOpenFile}>
        {'look at App.tsx:42 there'}
      </Response>,
    );
    (await screen.findByRole('button', { name: 'App.tsx:42' })).click();
    expect(onOpenFile).toHaveBeenCalledWith('apps/float/src/App.tsx', 42);
  });

  it('leaves an unconfirmed name plain even beside a confirmed one', async () => {
    const { container } = render(
      <Response mentions={mentions} onOpenFile={vi.fn()}>
        {'notes/todo.md and imaginary.md'}
      </Response>,
    );
    await screen.findByText(/imaginary\.md/);
    const labels = [...container.querySelectorAll('button')].map((b) => b.textContent);
    expect(labels).toEqual(['notes/todo.md']);
  });

  it('links a name written in inline code', async () => {
    render(
      <Response mentions={mentions} onOpenFile={vi.fn()}>
        {'the `notes/todo.md` file'}
      </Response>,
    );
    expect(await screen.findByRole('button', { name: 'notes/todo.md' })).toBeTruthy();
  });

  // Fenced blocks are full of paths that are examples, not references.
  it('leaves a path inside a fenced code block plain', async () => {
    const { container } = render(
      <Response mentions={mentions} onOpenFile={vi.fn()}>
        {'before\n\n```\ncat notes/todo.md\n```\n\nafter'}
      </Response>,
    );
    await screen.findByText(/before/);
    expect(container.querySelector('button')).toBeNull();
  });

  it('keeps the surrounding prose intact', async () => {
    const { container } = render(
      <Response mentions={mentions} onOpenFile={vi.fn()}>
        {'I wrote notes/todo.md for you'}
      </Response>,
    );
    await screen.findByRole('button', { name: 'notes/todo.md' });
    expect(container.textContent).toBe('I wrote notes/todo.md for you');
  });
});
