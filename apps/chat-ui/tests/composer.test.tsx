// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';

/**
 * The composer, which until now was the largest untested thing in the app.
 *
 * It earned a test the hard way. Typing one ordinary sentence into it makes
 * React complain that the maximum update depth was exceeded — a warning on
 * React 18, a thrown exception on 19 — and, worse, it *drops characters*: a
 * message typed as "the command \"help\" and tell me" reached the harness as
 * `andtell me`. Corrupted input goes to the model, not just to the screen.
 *
 * So the assertion is not "does it render". It is that typing a sentence
 * produces that sentence, and produces no React complaint about update depth.
 *
 * The delay is deliberately `null`. Paced typing does not reproduce this — React
 * settles between keystrokes and the redundant updates never stack up. It takes
 * a burst: a paste, or a fast typist.
 *
 * Still uncovered here: the slash menu's own open/close behaviour, which the fix
 * touches. It does not render under happy-dom in this harness and chasing that
 * was not worth the time; it is verified by using it.
 */

function stubFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/chat/sessions')) {
        return new Response(JSON.stringify({ sessions: [], items: [] }), { status: 200 });
      }
      if (url.includes('/approvals')) {
        return new Response(JSON.stringify({ requests: [] }), { status: 200 });
      }
      return new Response('{}', { status: 200 });
    }),
  );
}

/** Everything React writes to the console while the body runs. */
async function reactComplaints(body: () => Promise<void>): Promise<string[]> {
  const seen: string[] = [];
  const error = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    seen.push(args.map(String).join(' '));
  });
  const warn = vi.spyOn(console, 'warn').mockImplementation((...args: unknown[]) => {
    seen.push(args.map(String).join(' '));
  });
  try {
    await body();
  } finally {
    error.mockRestore();
    warn.mockRestore();
  }
  return seen;
}

async function textarea(): Promise<HTMLTextAreaElement> {
  await waitFor(() => expect(document.querySelector('textarea')).toBeTruthy());
  return document.querySelector('textarea') as HTMLTextAreaElement;
}

beforeEach(() => {
  localStorage.clear();
  stubFetch();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('typing into the composer', () => {
  /** The sentence that first showed this, near enough. */
  const SENTENCE = 'Run the local_shell tool with the command "help" and tell me what it prints.';

  it('keeps every character it was given', async () => {
    render(
      <ThemeProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ThemeProvider>,
    );
    const box = await textarea();

    await act(async () => {
      await userEvent.type(box, SENTENCE, { delay: null });
    });

    expect(box.value).toBe(SENTENCE);
  });

  it('does not drive React past its update-depth limit', async () => {
    const complaints = await reactComplaints(async () => {
      render(
        <ThemeProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>,
      );
      const box = await textarea();
      await act(async () => {
        await userEvent.type(box, SENTENCE, { delay: null });
      });
    });

    expect(complaints.filter((c) => /Maximum update depth/i.test(c))).toEqual([]);
  });
});
