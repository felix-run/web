import { useCallback, useSyncExternalStore } from 'react';

/**
 * What the side pane holds, per thread: the items open in it, which one is in
 * front, whether the pane is on screen, and the unsaved edits to any workspace
 * file among them.
 *
 * A module store rather than component state, for three reasons that each
 * broke a version of it. The pane's tabs render only the active item, so an
 * edit held in the editor's own state was lost on a tab switch. The workbench
 * unmounts on a visit to `/harness`, so it would have been lost there too. And
 * the things that open an item — the sidebar's file tree, a tool card, a code
 * block in a reply — are nowhere near the pane in the tree.
 *
 * Kept in `sessionStorage` per thread, so a reload brings the tabs and their
 * drafts back. Not `localStorage`: a draft is this tab's, and two tabs editing
 * one file from one store would each save over the other.
 */

export type PaneItem =
  | {
      kind: 'file';
      key: string;
      path: string;
      /**
       * Where the file lives. Absent: the browser's workspace (the mounted folder
       * or the in-tab store). `harness`: the thread's workspace on the harness
       * (`/chat/workspace/*`), which is where an agent with server-side file tools
       * works. A save goes back to the same place it was read from.
       */
      source?: 'harness';
      /** The operator's edit, when there is one. */
      draft?: string;
      /** The file's text when the draft began — what a save would overwrite. */
      base?: string;
      /** The file's text as last read, when it differs from `base`. */
      disk?: string;
    }
  | {
      kind: 'artifact';
      key: string;
      manifestId: string;
      artifactId: string;
      /** The tool whose output this is. */
      title: string;
      chars: number;
    }
  | { kind: 'code'; key: string; code: string; language: string; title: string }
  | { kind: 'image'; key: string; url: string; title: string }
  /**
   * The workspace's file trees — the browser's and the harness's, whichever the
   * thread's agent works in. One per thread, always the first tab, and never
   * dropped to make room: it is where the other file tabs come from.
   */
  | { kind: 'files'; key: string }
  /**
   * What one reply changed: the turns `from`..`to`, by position, as the
   * transcript's rows are named. One per thread — reviewing another reply
   * re-scopes it rather than adding a tab per reply.
   */
  | { kind: 'changes'; key: string; from: number; to: number }
  | {
      kind: 'skill';
      key: string;
      name: string;
      /** The library it is in: absent for the team's, `me` or a digest for a personal one. */
      library?: string;
      /** The editor's state, kept here because the tab unmounts it. Absent until it loads. */
      edit?: SkillEditSnapshot;
    };

/**
 * A skill editor's state between mounts. `files` is present only while the
 * working copy differs from `loadedFrom`; `rebase` and `resolutions` are the
 * "keep my edits on top of a newer version" choice in progress, which must
 * survive too — losing them would let a save undo files the newer version changed.
 */
export interface SkillEditSnapshot {
  loadedFrom: string;
  parent: string;
  files?: Record<string, string>;
  rebase?: { onto: string; base: string; mine: Record<string, string> };
  resolutions?: Record<string, 'theirs' | 'mine'>;
}

export type PaneItemInput = PaneItem extends infer T
  ? T extends PaneItem
    ? Omit<T, 'key'>
    : never
  : never;

export interface PaneState {
  items: readonly PaneItem[];
  active: string | null;
  /** On screen. False with items open means the instrument has the zone. */
  shown: boolean;
  /**
   * An action asked for from outside the pane — the sidebar tree's Rename… or
   * Delete… — for the file view of `key` to open when it mounts, then clear.
   * Not persisted: a reload does not re-ask.
   */
  request?: { key: string; action: 'rename' | 'delete' };
  /**
   * The operator closed Files on this thread, so a write must not open it again
   * (`addFilesTab`). Kept for the session, with the rest of the pane.
   */
  filesDismissed?: boolean;
}

/**
 * How many items stay open besides Files. The oldest clean one goes when a
 * seventh arrives; Files neither counts nor goes.
 */
export const PANE_LIMIT = 6;

/** Files' key: one per thread, so it is its own identity. */
export const FILES_KEY = 'files';

/** A reply's changes: one per thread, re-scoped by each Review. */
export const CHANGES_KEY = 'changes';

/** Past this, an item's content is not written to session storage (it stays open in memory). */
const PERSIST_LIMIT = 200_000;

const EMPTY: PaneState = { items: [], active: null, shown: false };
const KEY_PREFIX = 'felix.pane:';

const states = new Map<string, PaneState>();
const listeners = new Set<() => void>();

export function paneKey(item: PaneItemInput): string {
  switch (item.kind) {
    case 'file':
      return item.source === 'harness' ? `harness:${item.path}` : `file:${item.path}`;
    case 'artifact':
      return `artifact:${item.manifestId}/${item.artifactId}`;
    case 'code':
      return `code:${hash(`${item.language}\n${item.code}`)}`;
    case 'image':
      return `image:${hash(item.url)}`;
    case 'skill':
      return `skill:${item.library ?? ''}/${item.name}`;
    case 'files':
      return FILES_KEY;
    case 'changes':
      return CHANGES_KEY;
  }
}

/** A short stable id for content that is its own identity. Not a security boundary. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** A file item with its edit state dropped: what it is when nothing is unsaved. */
export function cleanFile(
  item: Extract<PaneItem, { kind: 'file' }>,
): Extract<PaneItem, { kind: 'file' }> {
  return {
    kind: 'file',
    key: item.key,
    path: item.path,
    ...(item.source ? { source: item.source } : {}),
  };
}

/**
 * The file a tree marks as selected: the one in front, or — while Files itself is
 * in front — the one opened most recently from `source`'s workspace, so the tree
 * still shows where the operator was.
 */
export function lastOpenedFile(state: PaneState, source?: 'harness'): string | null {
  if (!state.shown) return null;
  const files = state.items.filter(
    (i): i is Extract<PaneItem, { kind: 'file' }> => i.kind === 'file' && i.source === source,
  );
  const front = files.find((i) => i.key === state.active);
  if (front) return front.path;
  return state.active === FILES_KEY ? (files.at(-1)?.path ?? null) : null;
}

export function isDirty(item: PaneItem): boolean {
  if (item.kind === 'skill') return item.edit?.files !== undefined;
  return item.kind === 'file' && item.draft !== undefined && item.draft !== item.base;
}

/** The agent wrote the file under an unsaved edit: the edit's base is no longer what is on disk. */
export function hasConflict(item: PaneItem): boolean {
  return isDirty(item) && item.kind === 'file' && item.disk !== undefined;
}

export function paneState(threadId: string): PaneState {
  let s = states.get(threadId);
  if (!s) {
    s = restore(threadId);
    states.set(threadId, s);
  }
  return s;
}

function restore(threadId: string): PaneState {
  try {
    const raw = sessionStorage.getItem(KEY_PREFIX + threadId);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<PaneState>;
    const dismissed = parsed.filesDismissed === true ? { filesDismissed: true } : {};
    const items = Array.isArray(parsed.items) ? parsed.items.filter(isItem) : [];
    if (!items.length) return { ...EMPTY, ...dismissed };
    const active =
      typeof parsed.active === 'string' && items.some((i) => i.key === parsed.active)
        ? parsed.active
        : (items.at(-1)?.key ?? null);
    return { items, active, shown: parsed.shown !== false, ...dismissed };
  } catch {
    return EMPTY;
  }
}

function isItem(v: unknown): v is PaneItem {
  if (!v || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  if (typeof o.key !== 'string') return false;
  switch (o.kind) {
    case 'file':
      return typeof o.path === 'string';
    case 'artifact':
      return typeof o.manifestId === 'string' && typeof o.artifactId === 'string';
    case 'code':
      return typeof o.code === 'string' && typeof o.language === 'string';
    case 'image':
      return typeof o.url === 'string';
    case 'skill':
      return typeof o.name === 'string';
    case 'files':
      return o.key === FILES_KEY;
    case 'changes':
      return o.key === CHANGES_KEY && typeof o.from === 'number' && typeof o.to === 'number';
    default:
      return false;
  }
}

function persist(threadId: string, s: PaneState) {
  try {
    const key = KEY_PREFIX + threadId;
    if (!s.items.length && !s.filesDismissed) {
      sessionStorage.removeItem(key);
      return;
    }
    // An item too large to keep is left out of the copy, not out of the pane.
    const items = s.items.filter((i) => JSON.stringify(i).length <= PERSIST_LIMIT);
    const { request: _request, ...kept } = s;
    sessionStorage.setItem(key, JSON.stringify({ ...kept, items }));
  } catch {
    // Storage full or blocked: the pane lasts for this page.
  }
}

function update(threadId: string, next: (s: PaneState) => PaneState) {
  const prev = paneState(threadId);
  const s = next(prev);
  if (s === prev) return;
  states.set(threadId, s);
  persist(threadId, s);
  for (const l of listeners) l();
}

export function openInPane(threadId: string, input: PaneItemInput) {
  const key = paneKey(input);
  update(threadId, (s) => {
    // The one item whose key does not fix its content: Review on another reply
    // re-scopes the tab already open.
    if (input.kind === 'changes' && s.items.some((i) => i.key === key)) {
      const items = s.items.map((i) => (i.key === key ? ({ ...input, key } as PaneItem) : i));
      return { ...s, items, active: key, shown: true };
    }
    if (s.items.some((i) => i.key === key)) return { ...s, active: key, shown: true };
    return {
      ...s,
      items: withItem(s.items, { ...input, key } as PaneItem),
      active: key,
      shown: true,
    };
  });
}

/** `items` with `item` added: Files at the front, anything else at the end, then trimmed. */
function withItem(items: readonly PaneItem[], item: PaneItem): PaneItem[] {
  if (item.kind === 'files') return [item, ...items];
  let next = [...items, item];
  const counted = () => next.filter((i) => i.kind !== 'files').length;
  while (counted() > PANE_LIMIT) {
    const drop = next.find((i) => i.kind !== 'files' && !isDirty(i) && i.key !== item.key);
    if (!drop) break;
    next = next.filter((i) => i !== drop);
  }
  return next;
}

/**
 * Put Files in the pane without being asked — a run's first write to a file.
 * Nothing when it is already there or the operator closed it on this thread.
 * `show: false` adds it behind the instrument rather than taking the zone from
 * it; the pane comes forward with Files in front when the instrument closes.
 */
export function addFilesTab(threadId: string, { show }: { show: boolean }) {
  update(threadId, (s) => {
    if (s.filesDismissed || s.items.some((i) => i.kind === 'files')) return s;
    const items = withItem(s.items, { kind: 'files', key: FILES_KEY });
    return { ...s, items, active: FILES_KEY, shown: show || s.shown };
  });
}

/**
 * Ask a file's view to start renaming or deleting it, once it is open — the sidebar
 * tree's actions, which go through the pane so they get its guards: the hash
 * the file was read at, the hold while an edit is unsaved, the same wording.
 */
export function requestFileAction(
  threadId: string,
  input: Extract<PaneItemInput, { kind: 'file' }>,
  action: 'rename' | 'delete',
) {
  const key = paneKey(input);
  update(threadId, (s) => ({ ...s, request: { key, action } }));
}

/** The file view took the request: forget it. */
export function clearFileRequest(threadId: string) {
  update(threadId, (s) => (s.request ? { ...s, request: undefined } : s));
}

export function closePaneItem(threadId: string, key: string) {
  update(threadId, (s) => {
    const at = s.items.findIndex((i) => i.key === key);
    if (at === -1) return s;
    const items = s.items.filter((i) => i.key !== key);
    // The neighbour that slid into its place, or the one before it at the end.
    const active =
      s.active === key ? (items[Math.min(at, items.length - 1)]?.key ?? null) : s.active;
    const filesDismissed = s.filesDismissed || key === FILES_KEY;
    return {
      items,
      active,
      shown: items.length > 0 && s.shown,
      ...(filesDismissed ? { filesDismissed } : {}),
    };
  });
}

export function closeAllPaneItems(threadId: string) {
  update(threadId, (s) => {
    if (!s.items.length) return s;
    const filesDismissed = s.filesDismissed || s.items.some((i) => i.kind === 'files');
    return filesDismissed ? { ...EMPTY, filesDismissed } : EMPTY;
  });
}

export function setPaneActive(threadId: string, key: string) {
  update(threadId, (s) => (s.active === key ? s : { ...s, active: key }));
}

export function setPaneShown(threadId: string, shown: boolean) {
  update(threadId, (s) => (s.shown === shown || (shown && !s.items.length) ? s : { ...s, shown }));
}

/** Apply a change to one file item. */
export function updatePaneFile(
  threadId: string,
  key: string,
  change: (item: Extract<PaneItem, { kind: 'file' }>) => Extract<PaneItem, { kind: 'file' }>,
) {
  update(threadId, (s) => {
    let changed = false;
    const items = s.items.map((i) => {
      if (i.key !== key || i.kind !== 'file') return i;
      const next = change(i);
      if (next !== i) changed = true;
      return next;
    });
    return changed ? { ...s, items } : s;
  });
}

/** Keep a skill editor's state on its item. */
export function updatePaneSkill(threadId: string, key: string, edit: SkillEditSnapshot) {
  update(threadId, (s) => {
    let changed = false;
    const items = s.items.map((i) => {
      if (i.key !== key || i.kind !== 'skill') return i;
      changed = true;
      return { ...i, edit };
    });
    return changed ? { ...s, items } : s;
  });
}

/** Any thread's pane holding an unsaved edit — what a reload or a closed tab would lose. */
export function anyUnsaved(): boolean {
  for (const s of states.values()) if (s.items.some(isDirty)) return true;
  return false;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function usePaneState(threadId: string): PaneState {
  const get = useCallback(() => paneState(threadId), [threadId]);
  return useSyncExternalStore(subscribe, get, get);
}

/** For tests: forget every thread's pane. */
export function resetPanes() {
  states.clear();
  for (const l of listeners) l();
}
