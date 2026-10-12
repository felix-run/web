// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';
import { closePaneItem, FILES_KEY, paneState, resetPanes } from '../src/lib/side-pane';

/**
 * A run's first write opens Files — the tree the file landed in — in the side pane.
 * Pinned through the real `App` because what can break is the shell's effect: it
 * must fire on a write seen live and never on a thread loaded with past writes, and
 * a Files the operator closed stays closed for the rest of the session.
 */

const T = 'writer';

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

let call = 0;
function harness(transcript: unknown[], tools = 'server') {
  call = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.endsWith('/chat/stream')) {
        call += 1;
        const id = `c${call}`;
        const path = `notes/${call}.md`;
        return sse([
          { event: 'tool_start', data: { name: 'write_file', id, input: { path, content: 'x' } } },
          { event: 'tool_end', data: { name: 'write_file', id, output: `wrote ${path}` } },
          { event: 'text_delta', data: { delta: `Wrote ${path}.` } },
          { event: 'done', data: {} },
        ]);
      }
      if (url.endsWith('/v1/models')) {
        return Response.json({
          data: [{ id: 'cowork', felix: { workspace: { tools, scope: 'thread' } } }],
        });
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

async function send(text: string, reply: string) {
  const composer = await screen.findByRole('textbox', { name: /message/i });
  await act(async () => {
    await userEvent.type(composer, text);
    await userEvent.keyboard('{Enter}');
  });
  await screen.findByText(reply);
}

const greeting = [
  { id: 'e1', seq: 0, kind: 'message', role: 'user', content: 'hello' },
  { id: 'e2', seq: 1, kind: 'message', role: 'assistant', content: 'Hi.' },
];

describe('Files on a write', () => {
  it('opens in front, first, when a run writes a file', async () => {
    harness(greeting);
    await screen.findByText('Hi.');
    await send('write a note', 'Wrote notes/1.md.');
    await waitFor(() => expect(paneState(T).items[0]?.kind).toBe('files'));
    expect(paneState(T).active).toBe(FILES_KEY);
    expect(paneState(T).shown).toBe(true);
  });

  it('stays closed once the operator has closed it', async () => {
    harness(greeting);
    await screen.findByText('Hi.');
    await send('write a note', 'Wrote notes/1.md.');
    await waitFor(() => expect(paneState(T).items[0]?.kind).toBe('files'));
    act(() => closePaneItem(T, FILES_KEY));
    await send('write another', 'Wrote notes/2.md.');
    expect(paneState(T).items.some((i) => i.kind === 'files')).toBe(false);
  });

  it('opens nothing for writes already in the thread it loads', async () => {
    harness([
      { id: 'e1', seq: 0, kind: 'message', role: 'user', content: 'write a note' },
      {
        id: 'e2',
        seq: 1,
        kind: 'message',
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c0', name: 'write_file', args: { path: 'a.md', content: 'x' } }],
      },
      {
        id: 'e3',
        seq: 2,
        kind: 'tool_result',
        role: 'tool',
        content: 'wrote a.md',
        tool_call_id: 'c0',
      },
      { id: 'e4', seq: 3, kind: 'message', role: 'assistant', content: 'Done.' },
    ]);
    await screen.findByText('Done.');
    expect(paneState(T).items).toEqual([]);
  });

  it('opens nothing for an agent with no file tools', async () => {
    harness(greeting, 'none');
    await screen.findByText('Hi.');
    await send('write a note', 'Wrote notes/1.md.');
    expect(paneState(T).items.some((i) => i.kind === 'files')).toBe(false);
  });
});
