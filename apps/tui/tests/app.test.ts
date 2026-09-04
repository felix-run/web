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
    await ui.until(() => shows(ui.frame(), 'Activity'));
    expect(shows(ui.frame(), 'Memory')).toBe(true);
    await ui.keys.pressEscape();
    await ui.until(() => !shows(ui.frame(), 'Activity'));
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
