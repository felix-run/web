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
