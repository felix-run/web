// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';
import { paneState, resetPanes } from '../src/lib/side-pane';

/**
 * `open_file` (felix-run/felix#620): the agent showing the operator a file from the harness's
 * workspace. The harness opens nothing; a successful result names the path, and the shell opens
 * it in the thread's side pane as a harness file — the same item the sidebar's *On the harness*
 * tree opens. Pinned through the real `App` because what can break is the wiring between the
 * engine's port and the pane, and a thread rebuilt from its snapshot must not reopen the files
 * it opened before.
 */

const T = 'opener';
const OPENED = JSON.stringify({ opened: 'docs/README.md', kind: 'file', in: 'side_pane', size: 5 });

function sse(frames: unknown[]) {
  const body = frames.map((f) => `data: ${JSON.stringify(f)}`).join('\n\n');
  return new Response(`${body}\n\ndata: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  resetPanes();
});

function harness(transcript: unknown[]) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/chat/stream')) {
        return sse([
          {
            event: 'tool_start',
            data: { name: 'open_file', id: 'c9', input: { path: 'docs/README.md' } },
          },
          { event: 'tool_end', data: { name: 'open_file', id: 'c9', output: OPENED } },
          { event: 'text_delta', data: { delta: 'Opened it beside the conversation.' } },
          { event: 'done', data: {} },
        ]);
      }
      if (new RegExp(`/chat/sessions/${T}(\\?|$)`).test(url)) {
        return Response.json({ id: T, phase: 'idle', transcript });
      }
      return Response.json({ sessions: [], items: [], requests: [], events: [], data: [] });
    }),
  );
  render(
    <MemoryRouter initialEntries={[`/t/${T}`]}>
      <ThemeProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
}

const before = [
  { id: 'e1', seq: 0, kind: 'message', role: 'user', content: 'hello' },
  { id: 'e2', seq: 1, kind: 'message', role: 'assistant', content: 'Hi.' },
];

describe('open_file', () => {
  it("opens the file the agent names in this thread's pane, as a harness file", async () => {
    harness(before);
    await screen.findByText('Hi.');
    const composer = await screen.findByRole('textbox', { name: /message/i });
    await act(async () => {
      await userEvent.type(composer, 'open the readme');
      await userEvent.keyboard('{Enter}');
    });
    await screen.findByText('Opened it beside the conversation.');
    await waitFor(() => expect(paneState(T).active).toBe('harness:docs/README.md'));
    expect(paneState(T).items).toEqual([
      expect.objectContaining({ kind: 'file', path: 'docs/README.md', source: 'harness' }),
    ]);
  });

  it('opens nothing for a call that is already in the thread it loads', async () => {
    harness([
      { id: 'e1', seq: 0, kind: 'message', role: 'user', content: 'open the readme' },
      {
        id: 'e2',
        seq: 1,
        kind: 'message',
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c1', name: 'open_file', args: { path: 'docs/README.md' } }],
      },
      { id: 'e3', seq: 2, kind: 'tool_result', role: 'tool', content: OPENED, tool_call_id: 'c1' },
      { id: 'e4', seq: 3, kind: 'message', role: 'assistant', content: 'Opened it.' },
    ]);
    await screen.findByText('Opened it.');
    expect(paneState(T).items).toEqual([]);
  });
});
