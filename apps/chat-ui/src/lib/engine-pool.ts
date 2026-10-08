import type { ChatEngine } from '@felix/client';

/**
 * One chat engine per thread, so a run survives the operator leaving its thread.
 *
 * The shell used to hold a single engine whose ports read the *current* thread
 * at call time, so switching threads mid-run had only two options, both bad:
 * stop the run (which is what it did — `selectThread` posted `/chat/abort`), or
 * let it carry on writing its tool results and approvals to whichever thread
 * was now on screen. Hanging up without stopping is not a third option either:
 * the harness tears down a run whose client closes the stream.
 *
 * So each engine is bound to one thread for its whole life, and the pool keeps
 * the ones with a live run after the operator has moved on: still reading their
 * stream, still answering `tool_request`, still holding the thread's lease. One
 * with nothing in flight is dropped as soon as it is not on screen — the local
 * cache and the snapshot rebuild it on the next visit, exactly as before — so
 * the pool holds the foreground engine plus the live runs, and nothing else.
 *
 * Headless and framework-free: the shell subscribes for `runs()`.
 */

/** Which threads have a run in flight, and which of those are waiting on a person. */
export interface PoolRuns {
  running: ReadonlySet<string>;
  /** An approval or an agent's question is open on the thread's engine. */
  blocked: ReadonlySet<string>;
}

export interface EnginePoolOptions {
  /** Build the engine for `threadId`. Its ports must name that thread, never "the current one". */
  create(threadId: string): ChatEngine;
  /** A run started on `threadId`. What it returns is called when the run ends or is dropped. */
  onRunStart?(threadId: string): (() => void) | undefined;
  /** A run on `threadId` ended (the engine stopped streaming). Not called by `drop`. */
  onRunEnd?(threadId: string, engine: ChatEngine): void;
  /** `threadId`'s transcript changed. */
  onTurns?(threadId: string, engine: ChatEngine): void;
}

export interface EnginePool {
  /** The engine for `threadId`, created on first ask. */
  get(threadId: string): ChatEngine;
  /** The engine for `threadId` if the pool holds one, without creating it. */
  peek(threadId: string): ChatEngine | undefined;
  /** Forget `threadId`'s engine. Does not abort it — a caller stopping a run does that. */
  drop(threadId: string): void;
  /** Drop every engine but `keep`'s that has no run in flight. */
  prune(keep: string): void;
  /** Every engine with a run in flight, foreground included. */
  live(): ChatEngine[];
  runs(): PoolRuns;
  subscribe(listener: () => void): () => void;
}

interface Entry {
  engine: ChatEngine;
  unsubscribe: () => void;
  streaming: boolean;
  blocked: boolean;
  turns: ChatEngine['state']['turns'];
  release: (() => void) | null;
}

const NONE: PoolRuns = Object.freeze({ running: new Set<string>(), blocked: new Set<string>() });

export function createEnginePool(options: EnginePoolOptions): EnginePool {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let snapshot: PoolRuns = NONE;

  const publish = () => {
    const running = new Set<string>();
    const blocked = new Set<string>();
    for (const [id, entry] of entries) {
      if (entry.streaming) running.add(id);
      if (entry.blocked) blocked.add(id);
    }
    snapshot = running.size || blocked.size ? { running, blocked } : NONE;
    for (const listener of listeners) listener();
  };

  const observe = (threadId: string, entry: Entry) => {
    const s = entry.engine.state;
    if (s.turns !== entry.turns) {
      entry.turns = s.turns;
      options.onTurns?.(threadId, entry.engine);
    }
    // The entry may have been dropped by the callback above.
    if (entries.get(threadId) !== entry) return;
    const blocked = s.approvals.length > 0 || s.uiPrompt != null;
    let changed = blocked !== entry.blocked;
    entry.blocked = blocked;
    if (s.streaming !== entry.streaming) {
      changed = true;
      entry.streaming = s.streaming;
      if (s.streaming) {
        entry.release = options.onRunStart?.(threadId) ?? null;
      } else {
        entry.release?.();
        entry.release = null;
        options.onRunEnd?.(threadId, entry.engine);
      }
    }
    if (changed) publish();
  };

  const drop = (threadId: string) => {
    const entry = entries.get(threadId);
    if (!entry) return;
    entries.delete(threadId);
    entry.unsubscribe();
    entry.release?.();
    entry.release = null;
    if (entry.streaming || entry.blocked) publish();
  };

  return {
    get(threadId) {
      const found = entries.get(threadId);
      if (found) return found.engine;
      const engine = options.create(threadId);
      // Subscribed only after `create` has seeded it: a listener firing inside a
      // render would be a state update in the middle of one.
      const entry: Entry = {
        engine,
        unsubscribe: () => {},
        streaming: engine.state.streaming,
        blocked: false,
        turns: engine.state.turns,
        release: null,
      };
      entry.unsubscribe = engine.subscribe(() => observe(threadId, entry));
      entries.set(threadId, entry);
      return engine;
    },
    peek(threadId) {
      return entries.get(threadId)?.engine;
    },
    drop,
    prune(keep) {
      for (const [id, entry] of [...entries]) {
        if (id !== keep && !entry.streaming) drop(id);
      }
    },
    live() {
      return [...entries.values()].filter((e) => e.streaming).map((e) => e.engine);
    },
    runs() {
      return snapshot;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
