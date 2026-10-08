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
  /**
   * The agents' questions (`ask_user` → `ui_request`) open on any engine, by
   * thread. A question never appears in `/approvals`, so for a run in the
   * background this is the only record of it a surface can read.
   */
  questions: ReadonlyArray<{ threadId: string; prompt: string }>;
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
  /**
   * Drop every engine but `keep`'s that has no run in flight and is not pinned.
   * `keep` is remembered as the foreground, which `pin`'s release consults.
   */
  prune(keep: string): void;
  /**
   * Keep `threadId`'s engine through a prune while a send is on its way — an
   * image upload, a regenerate's history reset — and has not started streaming
   * yet. Without it, switching threads in that window dropped the engine, and
   * the send then ran on an orphan nothing tracked: no lease, no polls, no cache.
   * The returned release is idempotent; once it runs, an engine that is neither
   * streaming nor in the foreground goes.
   */
  pin(threadId: string): () => void;
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
  question: string | null;
  pins: number;
  release: (() => void) | null;
}

const NONE: PoolRuns = Object.freeze({
  running: new Set<string>(),
  blocked: new Set<string>(),
  questions: [],
});

export function createEnginePool(options: EnginePoolOptions): EnginePool {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let snapshot: PoolRuns = NONE;
  let foreground: string | null = null;

  const publish = () => {
    const running = new Set<string>();
    const blocked = new Set<string>();
    const questions: { threadId: string; prompt: string }[] = [];
    for (const [id, entry] of entries) {
      if (entry.streaming) running.add(id);
      if (entry.blocked) blocked.add(id);
      if (entry.question != null) questions.push({ threadId: id, prompt: entry.question });
    }
    snapshot = running.size || blocked.size ? { running, blocked, questions } : NONE;
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
    const question = s.uiPrompt?.prompt ?? null;
    let changed = blocked !== entry.blocked || question !== entry.question;
    entry.blocked = blocked;
    entry.question = question;
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
        question: null,
        pins: 0,
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
      foreground = keep;
      for (const [id, entry] of [...entries]) {
        if (id !== keep && !entry.streaming && entry.pins === 0) drop(id);
      }
    },
    pin(threadId) {
      const entry = entries.get(threadId);
      if (!entry) return () => {};
      entry.pins += 1;
      let released = false;
      return () => {
        if (released) return;
        released = true;
        entry.pins -= 1;
        if (
          entries.get(threadId) === entry &&
          entry.pins === 0 &&
          !entry.streaming &&
          threadId !== foreground
        ) {
          drop(threadId);
        }
      };
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
