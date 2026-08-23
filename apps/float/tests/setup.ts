/**
 * `src/lib/auth.ts` reads the gate key from localStorage on every API call, so
 * the API tests need one. A four-method in-memory stand-in beats pulling in
 * jsdom for it.
 */
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
