import { describe, expect, it } from 'bun:test';
import type { ReactElement } from 'react';
import { createElement } from 'react';
import { App } from '../src/app';
import type { Attention } from '../src/attention';
import type { Config } from '../src/config';
import type { PromptHistory } from '../src/history';
import type { ThreadStore } from '../src/threads';
import { type Mounted, mount, shows } from './render';

/**
 * The file that had no test.
 *
 * `app.tsx` holds the slash commands, the global key table and the rule that
 * exactly one blocking prompt is mounted at a time — and until this file none
 * of it was covered, which made "behaviour-preserving refactor" a claim with
 * nothing able to contradict it. These are characterization tests: they pin
 * what the client does *now*, so the decomposition that follows has something
 * to be wrong against.
 *
 * Everything `App` needs is already injected except the harness client, which
 * it builds itself from `config.origin` — so the seam is `globalThis.fetch`.
 */

/** Records every request and answers each route with something plausible. */
function harness(routes: Record<string, unknown> = {}) {
  const calls: Array<{ url: string; method: string; body?: unknown }> = [];
  const original = globalThis.fetch;

  globalThis.fetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body ? JSON.parse(String(init.body)) : undefined,
    });
    const hit = Object.entries(routes).find(([path]) => url.includes(path));
    // A function answers with its own Response — how a route streams SSE.
    if (typeof hit?.[1] === 'function') return (hit[1] as () => Response)();
    return new Response(JSON.stringify(hit ? hit[1] : {}), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof globalThis.fetch;

  return {
    calls,
    restore: () => {
      globalThis.fetch = original;
    },
    /** Requests to a route, ignoring the origin and the query string. */
    to(path: string) {
      return calls.filter((c) => c.url.includes(path));
    },
  };
}

const config = (over: Partial<Config> = {}): Config =>
  ({
    origin: 'http://localhost:8080',
    manifest: 'quick',
    yes: false,
    insecure: false,
    ...over,
  }) as Config;

function doubles() {
  const saved: Record<string, unknown[]> = {};
  const store: ThreadStore = {
    list: () => [],
    loadTurns: () => [],
    saveTurns: (id, turns) => {
      saved[id] = turns;
    },
    index: () => {},
    remove: () => {},
  };
  const history: PromptHistory = { entries: () => [], add: () => {} };
  const attention: Attention = {
    begin: () => {},
    end: () => {},
    set: () => {},
    setFocus: () => {},
    attach: () => {},
    dispose: () => {},
  };
  return { store, history, attention, saved };
}

/** Mount the real App, type a line, and let everything settle. */
async function run(
  line: string,
  opts: { routes?: Record<string, unknown>; onExit?: () => void } = {},
) {
  const h = harness(opts.routes);
  const { store, history, attention } = doubles();
  const ui: Mounted = await mount(
    createElement(App, {
      config: config(),
      store,
      history,
      attention,
      epilogue: {},
      root: '/tmp/felix-test',
      onExit: opts.onExit ?? (() => {}),
    }) as ReactElement,
    { width: 100, height: 24 },
  );
  await ui.settle();
  await ui.keys.typeText(line);
  await ui.settle();
  await ui.keys.pressEnter();
  await ui.settle();
  return { ui, h, frame: () => ui.frame() };
}

describe('slash commands', () => {
  const MODELS = {
    '/v1/models': {
      data: [
        {
          id: 'quick',
          felix: {
            greeting: { headline: 'Ask me something quick', subtitle: null },
            starters: [
              { title: 'Calculate', prompt: 'What is 17.5% of 2,340?' },
              {
                title: 'Draft a reply',
                prompt: 'Draft a short, polite reply declining a meeting.',
              },
            ],
          },
        },
      ],
    },
  };

  it("greets with the manifest's headline and starters from /v1/models", async () => {
    const h = harness(MODELS);
    const { store, history, attention } = doubles();
    const ui: Mounted = await mount(
      createElement(App, {
        config: config(),
        store,
        history,
        attention,
        epilogue: {},
        root: '/tmp/felix-test',
        onExit: () => {},
      }) as ReactElement,
      { width: 100, height: 24 },
    );
    await ui.until(() => shows(ui.frame(), 'Ask me something quick'));
    expect(shows(ui.frame(), '1  Calculate')).toBe(true);
    expect(shows(ui.frame(), '2  Draft a reply')).toBe(true);
    ui.stop();
    h.restore();
  });

  /**
   * `/start` fills, it does not send: the greeting shows a title, and what
   * reaches the model has to be what was read on screen — the same rule that
   * makes a paste wait for Enter.
   */
  it('/start <n> puts the prompt in the composer, and Enter sends exactly that', async () => {
    const { ui, h, frame } = await run('/start 2', { routes: MODELS });
    await ui.until(() => shows(frame(), 'Draft a short, polite reply declining a meeting.'));
    expect(h.to('/chat/stream')).toHaveLength(0);
    await ui.keys.pressEnter();
    await ui.until(() => h.to('/chat/stream').length > 0);
    const body = h.to('/chat/stream')[0]?.body as { messages?: Array<{ content: string }> };
    expect(body.messages?.at(-1)?.content).toBe('Draft a short, polite reply declining a meeting.');
    ui.stop();
    h.restore();
  });

  it('/start leaves the cursor at the end, so typing adds to the prompt', async () => {
    const { ui, h, frame } = await run('/start 1', { routes: MODELS });
    await ui.until(() => shows(frame(), 'What is 17.5% of 2,340?'));
    await ui.keys.typeText(' Round it.');
    await ui.settle();
    await ui.keys.pressEnter();
    await ui.until(() => h.to('/chat/stream').length > 0);
    const body = h.to('/chat/stream')[0]?.body as { messages?: Array<{ content: string }> };
    expect(body.messages?.at(-1)?.content).toBe('What is 17.5% of 2,340? Round it.');
    ui.stop();
    h.restore();
  });

  it('/start out of range names the starters it has', async () => {
    const { ui, h, frame } = await run('/start 9', { routes: MODELS });
    await ui.until(() => shows(frame(), 'usage: /start <1–2>'));
    expect(h.to('/chat/stream')).toHaveLength(0);
    ui.stop();
    h.restore();
  });

  it('/start says so when the manifest declares none', async () => {
    const { ui, h, frame } = await run('/start 1');
    await ui.until(() => shows(frame(), 'quick declares no starters'));
    ui.stop();
    h.restore();
  });

  it('refuses a thinking level the harness does not have, and sends nothing', async () => {
    const { ui, h, frame } = await run('/think sideways');
    // `until`, not a bare read: the renderer goes idle before React commits, so
    // one settle is enough on a fast machine and was not enough on CI.
    await ui.until(() => shows(frame(), 'thinking levels'));
    expect(h.to('/chat/thinking')).toHaveLength(0);
    ui.stop();
    h.restore();
  });

  it('sends a valid thinking level as the harness spells it', async () => {
    const { ui, h } = await run('/think high');
    await ui.until(() => h.to('/chat/thinking').length > 0);
    const [call] = h.to('/chat/thinking');
    expect(call?.method).toBe('POST');
    expect((call?.body as { thinking_level?: string })?.thinking_level).toBe('high');
    ui.stop();
    h.restore();
  });

  it('shows help for a command that does not exist', async () => {
    const { ui, h, frame } = await run('/nope');
    // The help text is the list of real commands, so any one of them proves it.
    await ui.until(() => shows(frame(), '/rewind'));
    ui.stop();
    h.restore();
  });

  it('/open takes a numbered hit from the last /search, by thread suffix', async () => {
    // The wire spells a thread id `{tenant}:{suffix}` and clients store the
    // suffix only — the harness rejects a suffix containing `:`.
    const h = harness({
      '/chat/sessions/search': {
        hits: [{ thread_id: 'acme:thread-one', content: 'the cache work' }],
      },
      '/chat/sessions': { sessions: [] },
    });
    const { store, history, attention } = doubles();
    const ui = await mount(
      createElement(App, {
        config: config(),
        store,
        history,
        attention,
        epilogue: {},
        root: '/tmp/felix-test',
        onExit: () => {},
      }) as ReactElement,
      { width: 100, height: 24 },
    );
    await ui.settle();
    await ui.keys.typeText('/search anything');
    await ui.keys.pressEnter();
    await ui.settle();
    await ui.keys.typeText('/open 1');
    await ui.keys.pressEnter();
    await ui.settle();

    // Opening hydrates the chosen thread by its suffix, never the wire id.
    const snapshots = h.to('/chat/sessions/thread-one');
    expect(snapshots.length).toBeGreaterThan(0);
    expect(h.calls.some((c) => c.url.includes('acme%3A') || c.url.includes('acme:'))).toBe(false);
    ui.stop();
    h.restore();
  });

  it('/version <n> rewinds to the newest event under that version of the edited message', async () => {
    // u2 was edited into u2b: both hang off a1, and a2b is the leaf.
    const ev = (id: string, seq: number, role: 'user' | 'assistant', parent?: string) => ({
      id,
      seq,
      kind: 'message',
      role,
      content: `text ${id}`,
      ...(parent ? { metadata: { parent_id: parent } } : {}),
    });
    const { ui, h, frame } = await run('/version 1', {
      routes: {
        '/chat/sessions/': {
          leafId: 'a2b',
          transcript: [
            ev('u1', 1, 'user'),
            ev('a1', 2, 'assistant', 'u1'),
            ev('u2', 3, 'user', 'a1'),
            ev('a2', 4, 'assistant', 'u2'),
            ev('u2b', 5, 'user', 'a1'),
            ev('a2b', 6, 'assistant', 'u2b'),
          ],
        },
        '/chat/sessions': { sessions: [] },
      },
    });
    await ui.until(() => h.to('/chat/rewind').length > 0);
    // Version 1 is the original; its thread ends at a2, not at the message itself.
    expect((h.to('/chat/rewind')[0]?.body as { event_id?: string })?.event_id).toBe('a2');
    await ui.until(() => shows(frame(), 'version 2 of 2'));
    ui.stop();
    h.restore();
  });

  it('/version says so when no message on the branch was edited', async () => {
    const { ui, h, frame } = await run('/version 2');
    await ui.until(() => shows(frame(), 'no edited message on this branch'));
    expect(h.to('/chat/rewind')).toHaveLength(0);
    ui.stop();
    h.restore();
  });

  it('/quit leaves exactly once', async () => {
    let exits = 0;
    const { ui, h } = await run('/quit', { onExit: () => exits++ });
    expect(exits).toBe(1);
    ui.stop();
    h.restore();
  });
});

describe('the keyboard', () => {
  it('opens the thread rail on tab, and closes it again', async () => {
    const h = harness({ '/chat/sessions': { sessions: [] } });
    const { store, history, attention } = doubles();
    const ui = await mount(
      createElement(App, {
        config: config(),
        store,
        history,
        attention,
        epilogue: {},
        root: '/tmp/felix-test',
        onExit: () => {},
      }) as ReactElement,
      { width: 100, height: 24 },
    );
    await ui.settle();
    await ui.keys.pressTab();
    await ui.until(() => shows(ui.frame(), 'enter open'));
    await ui.keys.pressTab();
    await ui.until(() => !shows(ui.frame(), 'enter open'));
    ui.stop();
    h.restore();
  });
});

describe('exactly one prompt owns the keyboard', () => {
  /**
   * The rule the inspector will have to sit under.
   *
   * `useKeyboard` is a global subscription and a handler registered by a child
   * runs *before* `App`'s — so what actually keeps the app off the keyboard
   * while a run is waiting is the `blocked` guard, not `preventDefault`. Pin it
   * here, because the next overlay added to this file will be one guard away
   * from stealing `y` from an approval banner.
   */
  const approval = {
    id: 'ap-1',
    tenant_id: 't',
    manifest_id: 'quick',
    tool_name: 'write_file',
    call_signature: 'sig',
    args: { path: '/tmp/felix-test/notes.md', content: 'hello' },
    principal_subj: '',
    status: 'pending',
    created_at: Date.now(),
    decided_at: null,
    decided_by: '',
    decision_note: '',
    edited_args: null,
    rule_id: 'fs-write',
    ttl_seconds: null,
    expires_at: null,
    consumed_at: null,
  };

  async function blocked() {
    const h = harness({
      '/approvals': { requests: [approval] },
      '/chat/sessions': { sessions: [] },
    });
    const { store, history, attention } = doubles();
    const ui = await mount(
      createElement(App, {
        config: config(),
        store,
        history,
        attention,
        epilogue: {},
        root: process.cwd(),
        onExit: () => {},
      }) as ReactElement,
      // Tall enough for the banner: a write approval carries a diff, and a
      // shorter terminal clips it from the top.
      { width: 100, height: 40 },
    );
    await ui.until(() => shows(ui.frame(), 'notes.md'));
    return { ui, h };
  }

  it('draws the write approval as a diff, not a character count', async () => {
    const { ui, h } = await blocked();
    // What is being written, and where — the two things needed to judge it.
    expect(shows(ui.frame(), 'notes.md')).toBe(true);
    expect(shows(ui.frame(), '+ hello')).toBe(true);
    ui.stop();
    h.restore();
  });

  it('will not open the thread rail while a run is waiting on a person', async () => {
    const { ui, h } = await blocked();
    await ui.keys.pressTab();
    await ui.settle();
    expect(shows(ui.frame(), 'enter open')).toBe(false);
    // and the banner is still the thing on screen
    expect(shows(ui.frame(), 'notes.md')).toBe(true);
    ui.stop();
    h.restore();
  });

  it('answers the approval with y, and posts the decision', async () => {
    const { ui, h } = await blocked();
    await ui.keys.typeText('y');
    await ui.until(() => h.to('/approvals/ap-1/decide').length > 0);
    const [decide] = h.to('/approvals/ap-1/decide');
    expect(decide?.method).toBe('POST');
    expect((decide?.body as { status?: string })?.status).toBe('approved');
    ui.stop();
    h.restore();
  });
});

describe('the inspector', () => {
  async function app(routes: Record<string, unknown> = {}) {
    const h = harness({ '/chat/sessions': { sessions: [] }, ...routes });
    const { store, history, attention } = doubles();
    const ui = await mount(
      createElement(App, {
        config: config(),
        store,
        history,
        attention,
        epilogue: {},
        root: process.cwd(),
        onExit: () => {},
      }) as ReactElement,
      { width: 100, height: 40 },
    );
    await ui.settle();
    return { ui, h };
  }

  it('opens on shift+tab and closes on escape', async () => {
    const { ui, h } = await app();
    await ui.keys.pressTab({ shift: true });
    // `Audit`, not chat-ui's `Activity`: the strip's tabs are 7 characters at
    // eighty columns and this client takes the shorter honest word.
    await ui.until(() => shows(ui.frame(), 'Audit'));
    expect(shows(ui.frame(), 'Corpus')).toBe(true);
    await ui.keys.pressEscape();
    await ui.until(() => !shows(ui.frame(), 'Audit'));
    ui.stop();
    h.restore();
  });

  it('plain tab still opens the thread rail, not the inspector', async () => {
    // shift+Tab is ESC[Z and parses as `tab` with the shift flag, so a branch
    // that only checks the name opens the rail on both.
    const { ui, h } = await app();
    await ui.keys.pressTab();
    await ui.until(() => shows(ui.frame(), 'enter open'));
    expect(shows(ui.frame(), 'Activity')).toBe(false);
    ui.stop();
    h.restore();
  });

  it('reads the section it is showing, and only that one', async () => {
    const { ui, h } = await app({
      '/audit': { events: [{ id: 'e1', ts: Date.now(), event_type: 'tool_call', status: 'ok' }] },
    });
    await ui.keys.pressTab({ shift: true });
    await ui.until(() => shows(ui.frame(), 'tool_call'));
    // Activity is open; nothing else should have been fetched for the panel.
    expect(h.to('/audit').length).toBeGreaterThan(0);
    expect(h.to('/usage')).toHaveLength(0);
    expect(h.to('/plans')).toHaveLength(0);
    expect(h.to('/memory')).toHaveLength(0);
    ui.stop();
    h.restore();
  });

  it('will not open while a run is waiting on a person', async () => {
    // The rule the whole precedence chain exists for, end to end this time.
    const { ui, h } = await app({
      '/approvals': {
        requests: [
          {
            id: 'ap-1',
            tenant_id: 't',
            manifest_id: 'quick',
            tool_name: 'write_file',
            call_signature: 'sig',
            args: { path: `${process.cwd()}/notes.md`, content: 'hello' },
            principal_subj: '',
            status: 'pending',
            created_at: Date.now(),
            decided_at: null,
            decided_by: '',
            decision_note: '',
            edited_args: null,
            rule_id: 'fs-write',
            ttl_seconds: null,
            expires_at: null,
            consumed_at: null,
          },
        ],
      },
    });
    await ui.until(() => shows(ui.frame(), 'notes.md'));
    await ui.keys.pressTab({ shift: true });
    await ui.settle();
    expect(shows(ui.frame(), 'Activity')).toBe(false);
    expect(shows(ui.frame(), 'notes.md')).toBe(true);
    ui.stop();
    h.restore();
  });
});

/**
 * A durable run's answer arrives twice: in the session log the engine tails while the run works,
 * and again from `final` into the status turn. chat-ui re-reads the session when the run settles,
 * which is what makes the transcript authoritative again; the terminal never did, and showed the
 * reply twice on a `cowork` run against the reference harness.
 */
describe('a durable run that finishes', () => {
  const answer = 'the durable answer';
  const sse = (frames: Array<{ event: string; data: unknown }>) =>
    new Response(
      `${frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join('')}data: [DONE]\n\n`,
      { headers: { 'content-type': 'text/event-stream' } },
    );

  it('re-reads the session, so the answer is on screen once', async () => {
    const message = { id: 'e2', seq: 2, kind: 'message', role: 'assistant', content: answer };
    const { ui, h, frame } = await run('go', {
      routes: {
        '/chat/stream': () =>
          sse([
            { event: 'run_accepted', data: { resume_token: 'fib_1' } },
            { event: 'session_event', data: message },
            { event: 'final', data: { content: answer } },
          ]),
        '/chat/sessions/': {
          transcript: [{ id: 'e1', seq: 1, kind: 'message', role: 'user', content: 'go' }, message],
        },
      },
    });
    try {
      await ui.until(() =>
        h.to('/chat/sessions/').some((c) => c.method === 'GET' && !c.url.includes('lease')),
      );
      await ui.until(() => frame().split(answer).length - 1 === 1);
    } finally {
      ui.stop();
      h.restore();
    }
  });
});
