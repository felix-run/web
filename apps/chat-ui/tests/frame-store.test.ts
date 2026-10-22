/** @vitest-environment happy-dom */
import type { EngineState, Turn } from '@felix/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { frameStoreFor } from '../src/lib/frame-store';

function fakeEngine(turns: Turn[]) {
  const listeners = new Set<(s: EngineState) => void>();
  const engine = {
    state: {
      turns,
      phase: 'idle',
      streaming: true,
      reattaching: false,
      error: null,
      approvals: [],
      uiPrompt: null,
      permissionMode: null,
    } as EngineState,
    subscribe(l: (s: EngineState) => void) {
      listeners.add(l);
      return () => void listeners.delete(l);
    },
    set(next: Partial<EngineState>) {
      engine.state = { ...engine.state, ...next };
      for (const l of listeners) l(engine.state);
    },
    /** What the engine's `text_delta` does: a new active turn with longer content. */
    grow(chunk: string) {
      const turns = engine.state.turns.map((t, i, all) =>
        i === all.length - 1 ? { ...t, content: t.content + chunk } : t,
      );
      engine.set({ turns });
    },
  };
  return engine;
}

const reply = (): Turn[] => [
  { id: 'u', role: 'user', content: 'hi' },
  { id: 'a', role: 'assistant', content: '' },
];

describe('frameStoreFor', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('draws a burst of text deltas once, on the next frame, with all of them', () => {
    const engine = fakeEngine(reply());
    const store = frameStoreFor(engine);
    const onChange = vi.fn();
    store.subscribe(onChange);
    for (const chunk of ['a', 'b', 'c', 'd']) engine.grow(chunk);
    expect(onChange).not.toHaveBeenCalled();
    expect(store.getSnapshot().turns.at(-1)?.content).toBe('');
    // The handlers' view is never behind.
    expect(engine.state.turns.at(-1)?.content).toBe('abcd');
    vi.advanceTimersToNextFrame();
    expect(onChange).toHaveBeenCalledOnce();
    expect(store.getSnapshot().turns.at(-1)?.content).toBe('abcd');
  });

  it('draws at once anything but grown text', () => {
    const engine = fakeEngine(reply());
    const store = frameStoreFor(engine);
    const onChange = vi.fn();
    store.subscribe(onChange);
    engine.grow('partial');
    // A tool call starting changes the transcript's shape: drawn now, with the text before it.
    const turns = engine.state.turns.map((t) =>
      t.id === 'a' ? { ...t, tools: [{ id: 't1', name: 'grep', input: {}, done: false }] } : t,
    ) as Turn[];
    engine.set({ turns });
    expect(onChange).toHaveBeenCalledOnce();
    expect(store.getSnapshot().turns.at(-1)?.content).toBe('partial');
    // So does the run ending, an approval, an error.
    engine.set({ streaming: false });
    expect(onChange).toHaveBeenCalledTimes(2);
    engine.set({ error: 'boom' });
    expect(onChange).toHaveBeenCalledTimes(3);
  });

  it('waits on a timer, not a frame, while the page is hidden', () => {
    const hidden = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    try {
      const engine = fakeEngine(reply());
      const store = frameStoreFor(engine);
      const onChange = vi.fn();
      store.subscribe(onChange);
      engine.grow('x');
      vi.advanceTimersByTime(300);
      expect(onChange).toHaveBeenCalledOnce();
    } finally {
      hidden.mockRestore();
    }
  });

  it('reads the engine itself while nobody listens', () => {
    const engine = fakeEngine(reply());
    const store = frameStoreFor(engine);
    const off = store.subscribe(() => {});
    off();
    engine.grow('late');
    expect(store.getSnapshot()).toBe(engine.state);
    expect(frameStoreFor(engine)).toBe(store);
  });
});
