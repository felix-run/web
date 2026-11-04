// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
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
      // Ended as the harness ends every stream: a body without `[DONE]` is a drop,
      // and a dropped send goes back to the composer rather than clearing it.
      if (url.includes('/chat/stream')) {
        return new Response('data: [DONE]\n\n', {
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
      <MemoryRouter initialEntries={['/']}>
        <ThemeProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>,
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
        <MemoryRouter initialEntries={['/']}>
          <ThemeProvider>
            <TooltipProvider>
              <App />
            </TooltipProvider>
          </ThemeProvider>
        </MemoryRouter>,
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
      <MemoryRouter initialEntries={['/']}>
        <ThemeProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>,
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

  it("sends the agent's own command as typed, for the harness to expand", async () => {
    // `felix.commands` (felix-run/felix#599): without it, `/review` is refused above.
    const streamed: string[] = [];
    let modelsServed = false;
    localStorage.setItem('felix.manifest', 'cowork');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/v1/models')) {
          modelsServed = true;
          const data = [
            { id: 'cowork', felix: { commands: [{ name: 'review', argumentHint: '<file>' }] } },
          ];
          return new Response(JSON.stringify({ object: 'list', data }), { status: 200 });
        }
        if (url.includes('/chat/stream')) {
          streamed.push(String(init?.body ?? ''));
          return new Response('data: [DONE]\n\n', {
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
    const box = await mount();
    await waitFor(() => expect(modelsServed).toBe(true));

    await act(async () => {
      await userEvent.type(box, '/review a.py', { delay: null });
    });
    await act(async () => {
      await userEvent.keyboard('{Enter}');
    });

    await waitFor(() => expect(streamed.length).toBe(1));
    expect(JSON.parse(streamed[0] ?? '{}').messages.at(-1).content).toBe('/review a.py');
    await waitFor(() => expect(box.value).toBe(''));
  });

  /** A harness whose agent has one skill a person may run, or whose skills read `skillsStatus`. */
  function stubSkills(skillsStatus: number) {
    const streamed: string[] = [];
    const reads = { skills: 0 };
    localStorage.setItem('felix.manifest', 'cowork');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/v1/models')) {
          const data = [{ id: 'cowork', felix: { commands: [] } }];
          return new Response(JSON.stringify({ object: 'list', data }), { status: 200 });
        }
        if (url.includes('/skills/cowork')) {
          reads.skills += 1;
          const items = [
            { name: 'release-notes', description: 'Draft them', user_invocable: true },
            { name: 'model-only', description: 'Not for people', user_invocable: false },
          ];
          return new Response(JSON.stringify({ manifest: 'cowork', items }), {
            status: skillsStatus,
          });
        }
        if (url.includes('/chat/stream')) {
          streamed.push(String(init?.body ?? ''));
          return new Response('data: [DONE]\n\n', {
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
    return { streamed, reads };
  }

  async function send(box: HTMLTextAreaElement, text: string) {
    await act(async () => {
      await userEvent.type(box, text, { delay: null });
    });
    await act(async () => {
      await userEvent.keyboard('{Enter}');
    });
  }

  it('sends a skill a person may run as typed, for the harness to activate', async () => {
    // `felix.commands` lists prompts only (felix-run/felix#708): the skill comes from `/skills`.
    const { streamed, reads } = stubSkills(200);
    const box = await mount();
    await waitFor(() => expect(reads.skills).toBeGreaterThan(0));

    await send(box, '/release-notes v2');

    await waitFor(() => expect(streamed.length).toBe(1));
    expect(JSON.parse(streamed[0] ?? '{}').messages.at(-1).content).toBe('/release-notes v2');
  });

  it('still refuses a skill no person may run, once the list has been read', async () => {
    const { streamed, reads } = stubSkills(200);
    const box = await mount();
    await waitFor(() => expect(reads.skills).toBeGreaterThan(0));

    await send(box, '/model-only');

    expect(box.value).toBe('/model-only');
    expect(streamed).toEqual([]);
  });

  it('sends an unknown command as typed when the skills could not be read', async () => {
    // A sign-in without `skills:read`: refusing here would make every skill unreachable.
    const { streamed, reads } = stubSkills(403);
    const box = await mount();
    await waitFor(() => expect(reads.skills).toBeGreaterThan(0));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    await send(box, '/release-notes v2');

    await waitFor(() => expect(streamed.length).toBe(1));
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
