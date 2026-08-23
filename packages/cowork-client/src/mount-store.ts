/**
 * Remembering which folder was mounted, across reloads.
 *
 * A `FileSystemDirectoryHandle` is structured-cloneable, so IndexedDB can hold
 * one and hand it back after a reload. What does *not* survive the round trip is
 * the readwrite permission grant — that lives on the document, not the handle.
 * So a stored handle is a strong hint, never an entitlement; see
 * `restoreMount()` for what has to happen before it is usable again.
 *
 * localStorage cannot be used here: it stores strings, and a handle is an
 * opaque object with no serialization.
 */

export interface StoredMount {
  handle: FileSystemDirectoryHandle;
  name: string;
}

const DB_NAME = 'felix.cowork.mount';
const DB_VERSION = 1;
const STORE = 'handles';
const KEY = 'root';

function available(): boolean {
  return typeof indexedDB !== 'undefined';
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
  });
}

function withStore<T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => IDBRequest,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = run(tx.objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error ?? new Error('indexedDB request failed'));
        tx.oncomplete = () => db.close();
      }),
  );
}

/**
 * Every call is best-effort. Private windows, blocked site data, and storage
 * pressure all make IndexedDB throw or vanish, and none of them is a reason to
 * fail a mount that is working perfectly well in this tab.
 */
export async function saveStoredMount(mount: StoredMount): Promise<void> {
  if (!available()) return;
  try {
    await withStore('readwrite', (s) => s.put(mount, KEY));
  } catch {
    // remembered-ness is a convenience, not a requirement
  }
}

export async function loadStoredMount(): Promise<StoredMount | null> {
  if (!available()) return null;
  try {
    const found = await withStore<StoredMount | undefined>('readonly', (s) => s.get(KEY));
    // A record written by an older shape, or one whose handle failed to
    // deserialize, is indistinguishable from junk — drop it rather than
    // handing a caller something that will throw on first use.
    if (!found || typeof found !== 'object' || !found.handle) return null;
    return found;
  } catch {
    return null;
  }
}

export async function clearStoredMount(): Promise<void> {
  if (!available()) return;
  try {
    await withStore('readwrite', (s) => s.delete(KEY));
  } catch {
    // nothing to do; a stale record is re-validated on next restore anyway
  }
}
