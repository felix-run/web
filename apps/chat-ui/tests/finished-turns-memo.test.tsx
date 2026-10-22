// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';

/**
 * A finished turn renders nothing while the next reply streams (`TurnRow` in
 * `routes/workbench.tsx`). Every message used to be laid out again on every
 * frame to change only the last one. `interleaveTurn` is what `Message` runs to
 * lay a turn out, so its calls are counted per turn.
 */
const laidOut = vi.hoisted(() => [] as string[]);
vi.mock('@felix/client', async (original) => {
  const real = await original<typeof import('@felix/client')>();
  return {
    ...real,
    interleaveTurn: (...args: Parameters<typeof real.interleaveTurn>) => {
      laidOut.push(args[0]);
      return real.interleaveTurn(...args);
    },
  };
});

/** A stream that writes `chunks` one network chunk at a time, a frame apart. */
function slowStream(chunks: string[]) {
  const enc = new TextEncoder();
  return new Response(
    new ReadableStream({
      async start(c) {
        for (const text of chunks) {
          c.enqueue(
            enc.encode(
              `data: ${JSON.stringify({ event: 'text_delta', data: { delta: text } })}\n\n`,
            ),
          );
          await new Promise((r) => setTimeout(r, 20));
        }
        c.enqueue(enc.encode('data: [DONE]\n\n'));
        c.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('finished turns', () => {
  it('are not laid out again while the next reply streams', async () => {
    // Twelve chunks: enough to tell a turn redrawn per frame from one redrawn only when
    // the run starts and ends.
    const second = 'second reply in a good many small chunks one frame apart each'
      .split(' ')
      .map((w, i, all) => (i < all.length - 1 ? `${w} ` : w));
    const replies = [['first ', 'answer'], second];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/chat/stream')) return slowStream(replies.shift() ?? []);
        return Response.json({ sessions: [], items: [], requests: [] });
      }),
    );
    render(
      <MemoryRouter initialEntries={['/']}>
        <ThemeProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    const send = async (text: string) => {
      const box = await screen.findByRole('textbox', { name: /message/i });
      await act(async () => {
        await userEvent.type(box, text);
        await userEvent.keyboard('{Enter}');
      });
    };
    await send('one');
    await screen.findByText('first answer', undefined, { timeout: 3000 });

    laidOut.length = 0;
    await send('two');
    await screen.findByText(second.join(''), undefined, { timeout: 5000 });
    // The run's end is a render of its own, which can land after the last text does.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Stop generating' })).toBeNull(),
    );
    // The second reply was laid out as it grew…
    expect(laidOut.filter((c) => c.startsWith('second')).length).toBeGreaterThan(4);
    // …and the first, finished before it started, only as the run started and as it ended —
    // its actions depend on whether a run is live — and not once per chunk.
    expect(laidOut.filter((c) => c === 'first answer').length).toBeLessThanOrEqual(2);
  });
});
