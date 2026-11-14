/**
 * An engine's state for `useSyncExternalStore`, at most once per frame while a reply streams.
 *
 * The engine emits on every frame of the stream, and the SSE reader hands frames over one at a
 * time, so a network chunk carrying twenty deltas rendered the whole shell twenty times in one
 * task — none of which was ever painted. Here a change that only *grows text* — a turn's
 * `content`, or the reasoning block it is already writing — waits for the next animation frame
 * and is drawn once with whatever arrived meanwhile. Everything else is drawn at once: the run
 * starting or ending, an error, an approval, a question, the mode, and any change to the
 * transcript's shape (a turn, a tool call starting or ending, a new reasoning block). Banners must
 * never be a frame late, and parts of the shell react to what they *saw* mid-run — Files opening
 * on a write seen while streaming, a thought timed because it was watched being written — so a
 * structural step must not be merged into the end of the run that followed it in the same chunk.
 *
 * Only what React draws is deferred. `engine.state` stays exact for every handler that reads it,
 * so nothing that decides anything sees an older transcript. A hidden page gets no animation
 * frames at all, so there the wait is a short timer instead: the transcript cache and the tab's
 * presence still follow the run behind it.
 */
import type { ChatEngine, EngineState, Turn } from '@felix/client';

/** How long a hidden page lets transcript changes gather before drawing them. */
const HIDDEN_FRAME_MS = 250;

export interface FrameStore {
  subscribe(onChange: () => void): () => void;
  getSnapshot(): EngineState;
}

/** True when `next` is `prev` with only some turns' text grown (see the module comment). */
function textOnly(prev: EngineState, next: EngineState): boolean {
  for (const key of Object.keys(next) as (keyof EngineState)[]) {
    if (key !== 'turns' && prev[key] !== next[key]) return false;
  }
  if (prev.turns.length !== next.turns.length) return false;
  return next.turns.every((turn, i) => {
    const was = prev.turns[i];
    return was === turn || (was !== undefined && sameShape(was, turn));
  });
}

/** Same turn, differing at most in `content` and in the text of its existing reasoning blocks. */
function sameShape(a: Turn, b: Turn): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof Turn)[]);
  for (const key of keys) {
    if (key === 'content' || key === 'reasoning') continue;
    if (a[key] !== b[key]) return false;
  }
  return (a.reasoning?.length ?? 0) === (b.reasoning?.length ?? 0);
}

function createFrameStore(engine: Pick<ChatEngine, 'subscribe' | 'state'>): FrameStore {
  let snapshot = engine.state;
  const listeners = new Set<() => void>();
  let frame: number | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unsubscribe: (() => void) | undefined;

  const cancel = () => {
    if (frame !== undefined) cancelAnimationFrame(frame);
    clearTimeout(timer);
    frame = undefined;
    timer = undefined;
  };
  const flush = () => {
    cancel();
    if (snapshot === engine.state) return;
    snapshot = engine.state;
    for (const l of listeners) l();
  };
  const onEngine = (next: EngineState) => {
    if (!textOnly(snapshot, next)) return flush();
    if (frame !== undefined || timer !== undefined) return;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
      timer = setTimeout(flush, HIDDEN_FRAME_MS);
    } else {
      frame = requestAnimationFrame(flush);
    }
  };

  return {
    subscribe(onChange) {
      listeners.add(onChange);
      if (!unsubscribe) {
        // Caught up first: a change made while nobody listened has no flush coming.
        snapshot = engine.state;
        unsubscribe = engine.subscribe(onEngine);
      }
      return () => {
        listeners.delete(onChange);
        if (listeners.size === 0) {
          unsubscribe?.();
          unsubscribe = undefined;
          cancel();
        }
      };
    },
    getSnapshot() {
      // Nobody subscribed means no flush is coming: read the engine itself.
      if (listeners.size === 0) snapshot = engine.state;
      return snapshot;
    },
  };
}

const stores = new WeakMap<object, FrameStore>();

/** The one frame store for `engine`, so a re-render hands React the same subscribe. */
export function frameStoreFor(engine: Pick<ChatEngine, 'subscribe' | 'state'>): FrameStore {
  let store = stores.get(engine);
  if (!store) {
    store = createFrameStore(engine);
    stores.set(engine, store);
  }
  return store;
}
