// @vitest-environment happy-dom
import type { ThreadMeta } from '@felix/client';
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, type NavigateFunction, useNavigate } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';
import { ThreadTitle } from '../src/components/thread-title';
import { resetPresence } from '../src/lib/presence';

/**
 * The header names the thread on screen.
 *
 * Until it did, identity lived only in the sidebar's highlighted row, so with the
 * sidebar collapsed or a drawer nothing on the sheet said which conversation an
 * approval or a message was about to land in. These pin that the name is the
 * sidebar's, that renaming it is the sidebar's action, that a watching tab cannot
 * rename, that `/harness` names no thread, and that the title is not a second `h1`.
 *
 * happy-dom lays nothing out, so the middle cut is pinned by its parts — the
 * whole title in the DOM, its tail in a span of its own — not by pixels.
 */

const meta = (over: Partial<ThreadMeta> = {}): ThreadMeta => ({
  id: 'abc',
  title: 'Use write_file to create notes.txt with a summary…',
  manifest: 'cowork',
  updatedAt: Date.now(),
  ...over,
});

/**
 * The title as drawn from `sm` up. A long title is in the DOM twice — one
 * end-cut copy for a phone, one split copy from `sm` — and CSS picks one, which
 * happy-dom does not; a short one is drawn once.
 */
const shown = (el: Element | null | undefined) =>
  (el?.querySelector('.sm\\:flex') ?? el)?.textContent;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  document.body.innerHTML = '';
});

describe('ThreadTitle', () => {
  it('names the thread with the sidebar’s title, as a heading below the h1, and the agent in mono', () => {
    render(<ThreadTitle threadId="abc" thread={meta()} readOnly={false} onRename={() => {}} />);
    const heading = screen.getByRole('heading', { level: 2 });
    // Whole to a reader, however it is cut on screen.
    expect(shown(heading)).toBe('Use write_file to create notes.txt with a summary…');
    // Cut from the middle: the end that tells two such titles apart is its own
    // span, and never shrinks.
    const tail = [...heading.querySelectorAll('.sm\\:flex > span')].at(-1);
    expect(tail?.textContent).toBe('a summary…');
    expect(tail?.className).toContain('shrink-0');
    // A phone gets one end-cut of the whole title instead.
    const phone = heading.querySelector('.sm\\:hidden');
    expect(phone?.textContent).toBe('Use write_file to create notes.txt with a summary…');
    expect(phone?.className).toContain('truncate');
    const agent = document.querySelector('[data-slot="thread-agent"]') as HTMLElement;
    expect(agent.textContent).toContain('cowork');
    expect(agent.className).toContain('font-mono');
  });

  it('draws a thread with only an id as the sidebar does, muted mono', () => {
    render(
      <ThreadTitle
        threadId="ba3ff3b4-090e-4ce9-ad24-4f8b079cb439"
        thread={undefined}
        readOnly={false}
        onRename={() => {}}
      />,
    );
    const heading = screen.getByRole('heading', { level: 2 });
    expect(shown(heading)).toBe('ba3ff3b4-090e-4ce9-ad24-4f8b079cb439');
    const face = heading.querySelector('.font-mono');
    expect(face?.className).toContain('text-muted-foreground');
    // Nothing on the harness to name until the first message.
    expect(heading.querySelector('button')).toBeNull();
  });

  it('renames in place through the action it is given: Enter saves', async () => {
    const onRename = vi.fn();
    render(<ThreadTitle threadId="abc" thread={meta()} readOnly={false} onRename={onRename} />);
    const button = screen.getByRole('button', { name: /notes\.txt/ });
    expect(button.getAttribute('aria-describedby')).toBeTruthy();
    await userEvent.click(button);
    const field = await screen.findByRole('textbox', { name: 'Thread name' });
    await userEvent.type(field, 'Notes summary{Enter}');
    expect(onRename).toHaveBeenCalledOnce();
    expect(onRename).toHaveBeenCalledWith('abc', 'Notes summary');
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('starts from a typed name, and saves nothing it was not given', async () => {
    const onRename = vi.fn();
    render(
      <ThreadTitle
        threadId="abc"
        thread={meta({ title: 'Release notes', named: true })}
        readOnly={false}
        onRename={onRename}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: /Release notes/ }));
    const field = (await screen.findByRole('textbox', { name: 'Thread name' })) as HTMLInputElement;
    expect(field.value).toBe('Release notes');
    // Unchanged, then emptied: neither is a rename.
    await userEvent.type(field, '{Enter}');
    await userEvent.click(screen.getByRole('button', { name: /Release notes/ }));
    const again = await screen.findByRole('textbox', { name: 'Thread name' });
    await userEvent.clear(again);
    await userEvent.type(again, '{Enter}');
    expect(onRename).not.toHaveBeenCalled();
  });

  it('throws the draft away on Escape, even when the field blurs on its way out', async () => {
    const onRename = vi.fn();
    render(<ThreadTitle threadId="abc" thread={meta()} readOnly={false} onRename={onRename} />);
    await userEvent.click(screen.getByRole('button', { name: /notes\.txt/ }));
    const field = await screen.findByRole('textbox', { name: 'Thread name' });
    await userEvent.type(field, 'Never mind{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(onRename).not.toHaveBeenCalled();
  });

  it('is not editable while another client drives the thread', () => {
    render(<ThreadTitle threadId="abc" thread={meta()} readOnly onRename={() => {}} />);
    const heading = screen.getByRole('heading', { level: 2 });
    expect(heading.querySelector('button')).toBeNull();
    expect(heading.querySelector('[title]')?.getAttribute('title')).toContain(
      'Another client is driving this thread',
    );
  });
});

describe('the header, with the shell around it', () => {
  let go: NavigateFunction = () => {};
  function Probe() {
    go = useNavigate();
    return null;
  }

  beforeEach(() => {
    resetPresence();
    localStorage.setItem(
      'felix.threads',
      JSON.stringify([
        meta({ id: 'keep-me', title: 'Use write_file to create notes.txt…' }),
        meta({ id: 'other', title: 'The other one' }),
      ]),
    );
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/chat/sessions')) {
          return new Response(JSON.stringify({ sessions: [], items: [] }), { status: 200 });
        }
        return new Response(JSON.stringify({ requests: [], items: [], events: [] }), {
          status: 200,
        });
      }),
    );
  });

  function mount(at: string) {
    render(
      <MemoryRouter initialEntries={[at]}>
        <Probe />
        <ThemeProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
  }

  const title = () => document.querySelector<HTMLElement>('header [data-slot="thread-title"]');

  it('names the thread on /t, keeps one h1, and names none on /harness', async () => {
    mount('/t/keep-me');
    await waitFor(() =>
      expect(shown(title()?.querySelector('h2'))).toBe('Use write_file to create notes.txt…'),
    );
    expect(title()?.textContent).toContain('cowork');
    // The wordmark stays the page's one `h1`; the title is not a second.
    expect(document.querySelectorAll('h1')).toHaveLength(1);
    expect(title()?.querySelector('h1')).toBeNull();

    // Another thread, another name.
    await act(async () => go('/t/other'));
    await waitFor(() => expect(shown(title()?.querySelector('h2'))).toBe('The other one'));

    // `/harness` pages carry their own title, so the header names no thread.
    await act(async () => go('/harness/activity'));
    await waitFor(() => expect(document.querySelector('main header')).not.toBeNull());
    expect(title()).toBeNull();
    expect(document.querySelectorAll('h1')).toHaveLength(1);
  });

  it('renames through the shell’s own action, which posts the name', async () => {
    mount('/t/keep-me');
    const button = await waitFor(() => {
      const found = title()?.querySelector('button');
      expect(found).toBeTruthy();
      return found as HTMLButtonElement;
    });
    await userEvent.click(button);
    const field = await screen.findByRole('textbox', { name: 'Thread name' });
    await userEvent.type(field, 'Notes{Enter}');
    const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
    await waitFor(() =>
      expect(calls.some(([url]) => String(url).includes('/chat/sessions/name'))).toBe(true),
    );
    const [, init] = calls.find(([url]) => String(url).includes('/chat/sessions/name')) ?? [];
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      thread_id: 'keep-me',
      name: 'Notes',
    });
  });
});
