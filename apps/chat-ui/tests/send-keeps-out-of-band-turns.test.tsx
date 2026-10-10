// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';
import { vfs } from '../src/lib/cowork';
import { resetPresence } from '../src/lib/presence';
import { openInPane, resetPanes } from '../src/lib/side-pane';

/**
 * A send builds on the transcript as the engine holds it, not as the composer
 * last saw it.
 *
 * The composer is memoised without its callbacks, so its `onSubmit` can be a
 * closure from several renders back. `send` closed over that render's turns,
 * and wrote them back with the new message — so a turn that arrived without
 * re-rendering the composer vanished on the next send. Found live: save a
 * file in the side pane on an idle thread, the harness records the note and
 * the shell rebuilds the transcript to show it, send — the note is gone until
 * a reload. This drives exactly that path against a stubbed harness.
 */

/**
 * The composer as the memo can leave it: holding the first `onSubmit` it was
 * given. In the full app something usually re-renders it before a send, which
 * hid the bug here while it reproduced every time against a live harness, so
 * the test does not depend on that luck.
 */
const firstSubmit = vi.hoisted(() => ({ current: null as null | ((m: unknown) => unknown) }));
vi.mock('../src/components/chat/multimodal-input', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/components/chat/multimodal-input')>();
  return {
    ...real,
    MultimodalInput: (props: { onSubmit: (m: unknown) => unknown }) => {
      firstSubmit.current ??= props.onSubmit;
      return (
        <button
          type="button"
          onClick={() => void firstSubmit.current?.({ text: 'what changed?', files: [] })}
        >
          Send with the first handler
        </button>
      );
    },
  };
});

const THREAD = 'oob';
let told = false;

const ev = (seq: number, kind: string, role: string, content: string, metadata?: object) => ({
  id: `e${seq}`,
  seq,
  kind,
  role,
  content,
  ...(metadata ? { metadata } : {}),
});

function sse(frames: unknown[]) {
  const body = frames.map((f) => `data: ${JSON.stringify(f)}`).join('\n\n');
  return new Response(`${body}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetPresence();
  resetPanes();
  told = false;
  firstSubmit.current = null;
  localStorage.setItem(
    `felix.turns:${THREAD}`,
    JSON.stringify([
      { id: 'u1', role: 'user', content: 'hello' },
      { id: 'a1', role: 'assistant', content: 'OK', tools: [] },
    ]),
  );
  vfs.write('notes/plan.md', '# Plan\n');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/chat/workspace/edited')) {
        told = true;
        return new Response(JSON.stringify({ status: 'recorded', event_id: 'e3' }));
      }
      if (url.includes('/chat/stream')) {
        return sse([{ event: 'text_delta', data: { delta: 'noted' } }]);
      }
      if (url.includes(`/chat/sessions/${THREAD}`)) {
        const transcript = [ev(1, 'message', 'user', 'hello'), ev(2, 'message', 'assistant', 'OK')];
        if (told) {
          transcript.push(
            ev(3, 'custom', 'user', 'The operator edited `notes/plan.md`.', {
              type: 'workspace_edit',
              path: 'notes/plan.md',
              op: 'write',
              bytes: 20,
              in_context: true,
            }),
          );
        }
        return new Response(JSON.stringify({ id: `t:${THREAD}`, transcript }));
      }
      if (url.includes('/chat/sessions')) return new Response(JSON.stringify({ sessions: [] }));
      if (url.includes('/approvals')) return new Response(JSON.stringify({ requests: [] }));
      return new Response('{}');
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('a send after the transcript changed out of band', () => {
  it('keeps the note the side pane added, and the message lands after it', async () => {
    render(
      <MemoryRouter initialEntries={[`/t/${THREAD}`]}>
        <ThemeProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    await waitFor(() => expect(document.body.textContent).toContain('OK'));

    act(() => openInPane(THREAD, { kind: 'file', path: 'notes/plan.md' }));
    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'notes/plan.md source' }), {
      target: { value: '# Plan\n\nDeadline: Friday.\n' },
    });
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Saved. The agent was told, and reads it on its next turn.');
    await waitFor(() => expect(document.body.textContent).toContain('the agent was told'));

    await user.click(screen.getByRole('button', { name: 'Send with the first handler' }));

    const main = () => document.querySelector('main')?.textContent ?? '';
    await waitFor(() => expect(main()).toContain('noted'));
    const text = main();
    expect(text).toContain('the agent was told');
    expect(text.indexOf('the agent was told')).toBeLessThan(text.indexOf('what changed?'));
  });
});
