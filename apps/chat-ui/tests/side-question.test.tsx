// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';

/**
 * `/ask <question>`: a side question about the thread (`POST /chat/ask`). The harness adds
 * nothing to the thread, so neither may the client: the answer is a card above the composer,
 * never a turn, and the question is not sent as a message.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

function harness(answer: unknown) {
  const posts: Array<{ url: string; body: unknown }> = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'POST') {
        posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
      }
      if (url.endsWith('/chat/ask')) return Response.json(answer);
      if (/\/chat\/sessions\/asked(\?|$)/.test(url)) {
        return Response.json({
          id: 'asked',
          phase: 'idle',
          transcript: [
            { id: 'e1', seq: 0, kind: 'message', role: 'user', content: 'edit notes.md' },
            { id: 'e2', seq: 1, kind: 'message', role: 'assistant', content: 'Done.' },
          ],
        });
      }
      return Response.json({ sessions: [], items: [], requests: [], events: [] });
    }),
  );
  render(
    <MemoryRouter initialEntries={['/t/asked']}>
      <ThemeProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
  return posts;
}

async function ask(text: string) {
  await screen.findByText('Done.');
  const composer = (await screen.findByRole('textbox', {
    name: /message/i,
  })) as HTMLTextAreaElement;
  await act(async () => {
    await userEvent.type(composer, text);
    await userEvent.keyboard('{Escape}{Enter}');
  });
  return composer;
}

describe('a side question', () => {
  it('is answered beside the transcript, and sends no message', async () => {
    const posts = harness({ status: 'answered', answer: 'It edited **notes.md**.', usage: {} });
    const composer = await ask('/ask which file did it edit?');

    const card = await screen.findByRole('region', { name: 'Side question' });
    expect(card.textContent).toContain('which file did it edit?');
    await waitFor(() => expect(card.textContent).toContain('It edited notes.md.'));
    expect(card.textContent).toContain('Not added to the conversation');
    expect(posts.find((p) => p.url.endsWith('/chat/ask'))?.body).toEqual({
      thread_id: 'asked',
      question: 'which file did it edit?',
    });
    // Asked, not said: nothing streamed, and the question is not a turn.
    expect(posts.some((p) => p.url.endsWith('/chat/stream'))).toBe(false);
    expect(screen.queryAllByText('which file did it edit?')).toHaveLength(1);
    expect(composer.value).toBe('');

    await userEvent.click(screen.getByRole('button', { name: 'Dismiss side question' }));
    expect(screen.queryByRole('region', { name: 'Side question' })).toBeNull();
  });

  it('says when the conversation does not hold the answer', async () => {
    harness({ status: 'not_in_context', answer: 'NOT_IN_CONTEXT' });
    await ask('/ask what is the weather?');
    expect(await screen.findByText(/doesn't hold the answer/)).toBeTruthy();
  });

  it('keeps an empty /ask in the composer and asks nothing', async () => {
    const posts = harness({ status: 'answered', answer: 'x' });
    const composer = await ask('/ask ');
    await waitFor(() => expect(composer.value.trim()).toBe('/ask'));
    expect(posts.some((p) => p.url.endsWith('/chat/ask'))).toBe(false);
  });
});
