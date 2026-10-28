// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { Message } from '../src/components/chat/message';
import { Tool } from '../src/components/chat/tool';
import { summarizeRun } from '../src/lib/tool-run';
import type { ToolCall, Turn } from '../src/types';

/**
 * The Trace-based patterns in a turn: a run of routine calls folded into one line, a search
 * result drawn as its sources, and a publish said outside its card. What is pinned is what may
 * never fold (a failure, a denial, a plan) and that a third party's URL becomes a link only
 * when it is http(s).
 */

afterEach(cleanup);

const read = (path: string, output = 'text'): ToolCall => ({
  name: 'read_file',
  input: { path },
  output,
  done: true,
});
const shell = (cmd: string, exit = 0): ToolCall => ({
  name: 'run',
  input: { command: cmd },
  output: JSON.stringify({
    exit_code: exit,
    stdout: '',
    stderr: '',
    timed_out: false,
    truncated: false,
  }),
  done: true,
});
const turnOf = (tools: ToolCall[], content = ''): Turn => ({
  id: 'a1',
  role: 'assistant',
  content,
  tools,
});
const draw = (turn: Turn, verbose = false) =>
  render(
    <TooltipProvider>
      <Message turn={turn} verbose={verbose} />
    </TooltipProvider>,
  );

describe('summarizeRun', () => {
  it('says what the calls did, in the order each kind first appears', () => {
    expect(
      summarizeRun([
        { name: 'read_file', shell: false },
        { name: 'run', shell: true },
        { name: 'local_read', shell: false },
        { name: 'search_files', shell: false },
      ]),
    ).toBe('Read 2 files, ran 1 command, searched');
  });

  it('names a tool it has no verb for, and counts what is past three kinds', () => {
    expect(
      summarizeRun([
        { name: 'github__get_issue', shell: false },
        { name: 'github__get_issue', shell: false },
        { name: 'write_file', shell: false },
        { name: 'list_dir', shell: false },
        { name: 'fetch', shell: false },
        { name: 'fetch', shell: false },
      ]),
    ).toBe('Called github__get_issue ×2, wrote 1 file, listed 1 folder, 2 more calls');
  });
});

describe('a run of routine calls', () => {
  it('folds three or more into one closed line that opens to their cards', () => {
    draw(turnOf([read('a.md'), read('b.md'), shell('pnpm test')]));
    const line = screen.getByRole('button', { name: /Read 2 files, ran 1 command/ });
    expect(line.getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByText('3 calls')).toBeTruthy();
    expect(screen.queryByText('a.md')).toBeNull();
    fireEvent.click(line);
    expect(screen.getByText('a.md')).toBeTruthy();
    expect(screen.getByText('b.md')).toBeTruthy();
  });

  it('leaves two alone, and never folds a failed call or what debug shows', () => {
    draw(turnOf([read('a.md'), read('b.md')]));
    expect(document.querySelector('[data-slot=tool-run]')).toBeNull();
    cleanup();

    // The failure splits the stretch into two of two; neither is long enough to fold.
    draw(turnOf([read('a.md'), read('b.md'), shell('pnpm test', 1), read('c.md'), read('d.md')]));
    expect(document.querySelector('[data-slot=tool-run]')).toBeNull();
    expect(screen.getByText('exit 1')).toBeTruthy();
    cleanup();

    draw(turnOf([read('a.md'), read('b.md'), read('c.md')]), true);
    expect(document.querySelector('[data-slot=tool-run]')).toBeNull();
    expect(screen.getByText('c.md')).toBeTruthy();
  });

  it('keeps a plan where it is, and folds the routine calls around it', () => {
    const plan = JSON.stringify({
      id: 'p1',
      plan: { title: 'Ship', steps: [{ id: '1', title: 'Do it', status: 'pending' }] },
    });
    draw(
      turnOf([
        { name: 'plan_create', input: {}, output: plan, done: true },
        read('a.md'),
        read('b.md'),
        read('c.md'),
      ]),
    );
    expect(document.querySelector('[data-plan-id="p1"]')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Read 3 files/ })).toBeTruthy();
  });
});

describe('a search result', () => {
  const output = [
    '1. Image component | nextjs.org',
    '   https://nextjs.org/docs/app/api-reference/components/image',
    '   Optimize images.',
    '',
    '2. Click me',
    '   javascript:alert(1)',
    '',
    '3. Refund policy',
    '   handbook/refunds.md',
    '   Refunds within 14 days.',
  ].join('\n');

  it('is drawn as its sources, linking only an http(s) URL', () => {
    render(
      <Tool tool={{ name: 'web_search', input: { query: 'x' }, output, done: true }} verbose />,
    );
    expect(screen.getByText('3 sources')).toBeTruthy();
    const link = screen.getByRole('link', { name: /Image component/ });
    expect(link.getAttribute('href')).toBe(
      'https://nextjs.org/docs/app/api-reference/components/image',
    );
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(screen.getAllByRole('link')).toHaveLength(1);
    expect(screen.getByText('javascript:alert(1)')).toBeTruthy();
    expect(screen.getByText('handbook/refunds.md')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'raw' }));
    expect(screen.queryByRole('link')).toBeNull();
    expect(document.querySelector('[data-slot=tool-sources] pre')?.textContent).toBe(output);
  });
});

describe('a publish', () => {
  it('says where it landed outside the fold, with the compare link', () => {
    const sha = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';
    const output = `published 2 file(s) to felix-run/web:felix/fix as ${sha} (new branch, parent ${'0'.repeat(40)})\ncompare: https://github.com/felix-run/web/compare/main...felix/fix`;
    render(
      <Tool tool={{ name: 'publish_commits', input: { head_sha: sha }, output, done: true }} />,
    );
    const line = document.querySelector('[data-slot=publish-line]') as HTMLElement;
    expect(line.textContent).toContain('Published 2 files to felix-run/web:felix/fix');
    expect(line.textContent).toContain('a1b2c3d · new branch');
    const compare = screen.getByRole('link', { name: /Compare/ });
    expect(compare.getAttribute('href')).toBe(
      'https://github.com/felix-run/web/compare/main...felix/fix',
    );
  });
});
