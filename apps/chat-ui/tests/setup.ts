/**
 * `src/lib/auth.ts` reads the gate key from localStorage on every API call, and
 * the thread store keeps transcripts there. Under happy-dom a real one exists;
 * in the node environment used by the wire-level suites it does not, so this
 * installs a stand-in only when needed.
 */
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    get length() {
      return store.size;
    },
    clear: () => store.clear(),
    getItem: (k: string) => (store.has(k) ? (store.get(k) as string) : null),
    key: (i: number) => [...store.keys()][i] ?? null,
    removeItem: (k: string) => void store.delete(k),
    setItem: (k: string, v: string) => void store.set(k, String(v)),
  } as Storage;
}

/**
 * Shared polls are module state: a key's last answer would otherwise carry from
 * one test into the next, so a test expecting a failed read would see the
 * previous test's success. Every test starts with no reads in flight or cached.
 */
import { afterEach } from 'vitest';
import { resetSharedPolls } from '../src/hooks/useSharedPoll';

afterEach(() => {
  resetSharedPolls();
});
