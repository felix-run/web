// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, render, waitFor } from '@testing-library/react';
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

/** As `stubFetch`, but `/chat/stream` never closes, so the run stays in flight. */
function stubStreamingFetch() {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes('/chat/stream')) {
        return new Response(new ReadableStream({ start() {} }), {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        });
      }
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

/**
 * What a refusal costs.
 *
 * `PromptInput` clears the composer whenever `onSubmit` resolves, and keeps the
 * text only when it throws. Every guard in `handleSubmit` used to `return`, which
 * resolves, so the composer was emptied and a toast explained why afterwards. The
 * text is the only copy of what was typed; a textarea has no undo for that.
 *
 * These pin both halves of the fix. A refusal must leave the text alone, and an
 * accepted send must still clear it: "never clear" passes the first assertion and
 * breaks the app.
 *
 * Each case mounts its own App and reads the textarea out of *that* render's
 * container. The suite above leaves its trees mounted, so a bare
 * `document.querySelector('textarea')` returns the first App ever rendered and
 * every value here accumulates.
 */
describe('refusing a submission', () => {
  afterEach(cleanup);

  async function mount(): Promise<HTMLTextAreaElement> {
    const { container } = render(
      <ThemeProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ThemeProvider>,
    );
    await waitFor(() => expect(container.querySelector('textarea')).toBeTruthy());
    return container.querySelector('textarea') as HTMLTextAreaElement;
  }

  it('keeps the text when the command is not one this client knows', async () => {
    const box = await mount();

    await act(async () => {
      await userEvent.type(box, '/nosuchcommand', { delay: null });
    });
    await act(async () => {
      await userEvent.keyboard('{Enter}');
    });

    expect(box.value).toBe('/nosuchcommand');
  });

  /** Pasted, not typed: 32k keystrokes is not what this measures. */
  const OVERLONG = 'x'.repeat(32_001);

  it('keeps an over-limit message while idle, where the send button is disabled', async () => {
    const box = await mount();

    await act(async () => {
      box.focus();
      await userEvent.paste(OVERLONG);
    });
    await act(async () => {
      await userEvent.keyboard('{Enter}');
    });

    expect(box.value).toBe(OVERLONG);
  });

  /**
   * The same message, with a run in flight, which is the case that actually lost
   * text. `SendOrStop` swaps the `type="submit"` Send for a `type="button"` Stop
   * while streaming, so the `submitButton.disabled` check in PromptInput's Enter
   * handler finds no button and calls `requestSubmit()` anyway. Idle, that check
   * catches it; mid-run, nothing did.
   */
  it('keeps an over-limit message while a run is in flight', async () => {
    stubStreamingFetch();
    const box = await mount();

    await act(async () => {
      await userEvent.type(box, 'start a run', { delay: null });
    });
    await act(async () => {
      await userEvent.keyboard('{Enter}');
    });
    await waitFor(() => expect(box.value).toBe(''));

    await act(async () => {
      box.focus();
      await userEvent.paste(OVERLONG);
    });
    await act(async () => {
      await userEvent.keyboard('{Enter}');
    });

    expect(box.value).toBe(OVERLONG);
  });

  it('still clears the text when the message is accepted', async () => {
    const box = await mount();

    await act(async () => {
      await userEvent.type(box, 'an ordinary message', { delay: null });
    });
    await act(async () => {
      await userEvent.keyboard('{Enter}');
    });

    await waitFor(() => expect(box.value).toBe(''));
  });
});
