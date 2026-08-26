// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, render, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';

/**
 * The chat surface, driven the way a person drives it.
 *
 * `App.tsx` is where every SSE frame becomes something on screen, and until now
 * it was the largest thing in the repo verified only by running it.
 * `check-protocol-parity` proves a handler *exists* for each event the harness
 * emits — it compares names, and says nothing about whether the handler is
 * right. That is the hole these fill: a frame goes in at the wire, and the
 * assertion is on rendered output.
 *
 * So the seam is the whole app, not a extracted reducer. `handleEvent` is a
 * closure over a dozen setters and two mutable ids; lifting it out to make it
 * testable would mean refactoring the least-covered file in the repo before
 * having any coverage of it, which is backwards. Stubbing `fetch` and typing
 * into the composer costs a second per test and exercises the real path.
 */

/** One SSE body: an envelope per frame, terminated the way the harness does. */
function sse(frames: unknown[]) {
  const body = frames.map((f) => `data: ${JSON.stringify(f)}`).join('\n\n');
  return new Response(`${body}\n\ndata: [DONE]\n\n`, {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
}

/**
 * Everything the app fetches on mount answered with an empty success, so the
 * only interesting response is the stream. A 200 with an empty object is what
 * each of these routes returns when the tenant has nothing.
 */
function stubFetch(frames: unknown[], stream?: () => Response) {
  const fn = vi.fn(async (input: unknown) => {
    const url = String(input);
    if (url.includes('/chat/stream')) return (stream ?? (() => sse(frames)))();
    if (url.includes('/chat/sessions')) {
      return new Response(JSON.stringify({ sessions: [], items: [] }), { status: 200 });
    }
    if (url.includes('/approvals'))
      return new Response(JSON.stringify({ requests: [] }), { status: 200 });
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

function mount() {
  render(
    <ThemeProvider>
      <TooltipProvider>
        <App />
      </TooltipProvider>
    </ThemeProvider>,
  );
}

/** Type a message and send it, which is what opens the stream. */
async function send(text = 'hi') {
  await waitFor(() => expect(document.querySelector('textarea')).toBeTruthy());
  const box = document.querySelector('textarea') as HTMLTextAreaElement;
  await act(async () => {
    await userEvent.type(box, text);
    await userEvent.keyboard('{Enter}');
  });
}

const shown = () => document.body.textContent ?? '';

/** The collapsed reasoning disclosures currently on screen. */
const thoughtTriggers = () =>
  [...document.querySelectorAll('button')].filter((b) =>
    /Thought for a moment|Thinking/.test(b.textContent ?? ''),
  );

async function openThoughts() {
  const triggers = await waitFor(() => {
    const found = thoughtTriggers();
    expect(found.length).toBeGreaterThan(0);
    return found;
  });
  for (const t of triggers) await act(async () => void (await userEvent.click(t)));
}
const seeText = (needle: string) =>
  waitFor(() => expect(shown()).toContain(needle), { timeout: 3000 });

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('assistant text', () => {
  it('accumulates text_delta chunks in order', async () => {
    stubFetch([
      { event: 'text_delta', data: { delta: 'Hello' } },
      { event: 'text_delta', data: { delta: ', world' } },
    ]);
    mount();
    await send();
    await seeText('Hello, world');
  });

  it('reads on_chat_model_stream, the same frame under its LangChain name', async () => {
    stubFetch([{ event: 'on_chat_model_stream', data: { chunk: { content: 'from the alias' } } }]);
    mount();
    await send();
    await seeText('from the alias');
  });

  it('falls back to the final frame when the model streamed no deltas', async () => {
    stubFetch([{ event: 'done', data: { final: { content: 'the whole answer at once' } } }]);
    mount();
    await send();
    await seeText('the whole answer at once');
  });

  it('keeps streamed text rather than overwriting it with final', async () => {
    stubFetch([
      { event: 'text_delta', data: { delta: 'streamed' } },
      { event: 'done', data: { final: { content: 'DIFFERENT' } } },
    ]);
    mount();
    await send();
    await seeText('streamed');
    expect(shown()).not.toContain('DIFFERENT');
  });
});

describe('tool calls', () => {
  it('renders a tool card on tool_start and settles it on tool_end', async () => {
    stubFetch([
      { event: 'tool_start', data: { name: 'read_file', id: 'tc1', input: { path: 'a.ts' } } },
      { event: 'text_delta', data: { delta: 'read it' } },
      { event: 'tool_end', data: { name: 'read_file', id: 'tc1', output: 'contents' } },
    ]);
    mount();
    await send();
    await seeText('read_file');
    await seeText('read it');
  });

  it('settles a tool still marked running when the turn ends', async () => {
    // The spinner outliving the run that owned it is the failure here: `done`
    // marks every unfinished tool finished, so a dropped `tool_end` cannot
    // leave a card spinning forever.
    stubFetch([
      { event: 'tool_start', data: { name: 'search', id: 'tc9' } },
      { event: 'done', data: { final: { content: 'done anyway' } } },
    ]);
    mount();
    await send();
    await seeText('search');
    await seeText('done anyway');
  });
});

describe('usage', () => {
  it('renders the per-turn token counts from on_chain_end', async () => {
    stubFetch([
      { event: 'text_delta', data: { delta: 'counted' } },
      { event: 'on_chain_end', data: { output: { usage: { input: 1200, output: 340 } } } },
    ]);
    mount();
    await send();
    await seeText('1,200 in');
    await seeText('340 out');
    // The total is computed, not sent — the one number here nothing upstream owns.
    await seeText('1,540 tok');
  });
});

describe('failure after a 200', () => {
  it('surfaces the normalised on_error frame', async () => {
    // `event: error` is the harness's one SSE-typed frame and the only way a
    // stream reports a failure that happened after its status line was sent.
    // `readSseStream` normalises it to `on_error`, which the harness never emits.
    stubFetch(
      [],
      () =>
        new Response(
          'event: error\ndata: {"error":{"message":"upstream exploded","type":"api"}}\n\n',
          {
            status: 200,
            headers: { 'content-type': 'text/event-stream' },
          },
        ),
    );
    mount();
    await send();
    await seeText('upstream exploded');
  });
});

describe('the agent talking to itself', () => {
  it('renders a drained steer as a real user message', async () => {
    // A queued steer is a user message in the session log. Rendering it is what
    // keeps the reply from silently changing direction mid-turn.
    stubFetch([
      { event: 'text_delta', data: { delta: 'first answer' } },
      { event: 'steer', data: { content: 'actually, do it differently' } },
      { event: 'text_delta', data: { delta: 'second answer' } },
    ]);
    mount();
    await send();
    await seeText('actually, do it differently');
    await seeText('second answer');
    // The steer opened a new turn, so the first answer is still its own message.
    expect(shown()).toContain('first answer');
  });
});

describe('what the app does not read', () => {
  it('ignores the reasoning riding inside session_progress', async () => {
    // Documented, not aspirational. The harness puts every delta in
    // `session_progress.progress` as well, thinking included, and this handler
    // reads `phase` and drops the rest. `check-protocol-parity` cannot see it:
    // the event name has a handler, so parity passes while the payload's most
    // interesting field goes unread. Delete this test when the arm learns to
    // read `progress` — it is pinning a gap, not a guarantee.
    stubFetch([
      {
        event: 'session_progress',
        data: {
          phase: 'turn',
          progress: { type: 'assistant_delta', kind: 'thinking', delta: 'let me think' },
        },
      },
      { event: 'text_delta', data: { delta: 'the answer' } },
    ]);
    mount();
    await send();
    await seeText('the answer');
    expect(shown()).not.toContain('let me think');
  });
});

describe('reasoning', () => {
  it('renders a thinking_delta block separately from the answer', async () => {
    stubFetch([
      { event: 'thinking_delta', data: { delta: 'weighing the options' } },
      { event: 'text_delta', data: { delta: 'the answer' } },
    ]);
    mount();
    await send();
    await seeText('the answer');
    // Collapsed by default — the summary is the affordance, the text is behind it.
    await seeText('Thought for a moment');
    await openThoughts();
    await seeText('weighing the options');
  });

  it('keeps thinking either side of a tool call as two thoughts', async () => {
    // Consecutive thinking at the same point in the prose is one block; a tool
    // call moves the offset on, so the second stretch starts a new one rather
    // than merging into a single stream of consciousness.
    stubFetch([
      { event: 'thinking_delta', data: { delta: 'before' } },
      { event: 'text_delta', data: { delta: 'calling out' } },
      { event: 'tool_start', data: { name: 'grep', id: 't1' } },
      { event: 'tool_end', data: { name: 'grep', id: 't1', output: 'ok' } },
      { event: 'thinking_delta', data: { delta: 'after' } },
      { event: 'text_delta', data: { delta: 'concluding' } },
    ]);
    mount();
    await send();
    await seeText('concluding');
    const triggers = await waitFor(() => {
      const found = thoughtTriggers();
      expect(found.length).toBe(2);
      return found;
    });
    for (const t of triggers) await act(async () => void (await userEvent.click(t)));
    await seeText('before');
    await seeText('after');
  });
});

describe('durable runs', () => {
  it('renders the answer from final when a durable run streams no deltas', async () => {
    // `spec.execution.mode: durable` makes /chat/stream carry the run's
    // progress instead of tokens: run_accepted → run_status → final, and not a
    // single delta the whole way.
    stubFetch([
      { event: 'run_accepted', data: { resume_token: 'rt-1' } },
      { event: 'run_status', data: { status: 'running' } },
      { event: 'final', data: { content: 'the durable answer' } },
    ]);
    mount();
    await send();
    await seeText('the durable answer');
  });
});
