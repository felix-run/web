import type {
  BranchPoint,
  ChatEngine,
  EngineDiagnostics,
  ManifestEntry,
  SideAnswer,
  ThreadMeta,
} from '@felix/client';
import {
  createContext,
  createElement,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useContext,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import type { KeptMessage } from '@/components/chat/multimodal-input';
import type { SlashCommand } from '@/components/chat/slash-commands';
import type { Driver } from '@/components/chat/watching-banner';
import type { MessageQueue } from '@/hooks/use-message-queue';
import type { PendingApprovals } from '@/hooks/use-pending-approvals';
import type { PaneItemInput } from '@/lib/side-pane';
import type { ImageAttachment, ThinkingLevel, TurnFeedback } from '@/types';

/**
 * Engine-sourced fields are derived rather than re-declared, so a change to the
 * engine's state shape reaches this context as a type error instead of as a
 * second, quietly diverging definition of the same thing.
 */
type EngineState = ChatEngine['state'];

/**
 * What the root layout owns and the routes beneath it render.
 *
 * The layout holds the engine, the thread, the approval queue and the poll —
 * everything whose lifetime is the tab rather than the address — and a route is
 * a view onto it. That is why this is one wide object and not a handful of
 * narrow props: the split is by *lifetime*, not by topic, so the honest shape of
 * the seam is "all of the shell's state, read-only to whoever is below it".
 */
/** A side question and how it stands: waiting, answered, or failed with a sentence. */
/**
 * The View setting, a ladder rather than independent switches: debug's main
 * piece is a tab inside the instrument, so debug without harness view would be
 * ids with no Debug tab.
 */
export type ViewLevel = 'everyday' | 'harness' | 'debug';

export interface ThreadIndexStatus {
  error: unknown;
  /** Failed reads in a row. */
  failures: number;
  rememberedAt: number | null;
  /** Ask the harness for the index again now. */
  retry(): void;
}

export interface SideQuestion {
  question: string;
  pending: boolean;
  answer?: SideAnswer;
  error?: string;
}

export interface ShellValue {
  /** The live run. */
  turns: EngineState['turns'];
  streaming: boolean;
  /**
   * The stream dropped and we are rejoining the thread — a materially different
   * claim from `streaming`, because that run was torn down.
   */
  reattaching: boolean;
  /**
   * The last reattach followed the operator leaving the page — on a phone, the
   * app switch that suspended it. Cleared by the next send or thread.
   */
  leftApp: boolean;
  /** The last reattach followed a drop with any other cause. Same lifetime as `leftApp`. */
  dropped?: boolean;
  error: EngineState['error'];
  /** The engine's phase, or null while it is resting; a chip renders it. */
  sessionPhase: string | null;

  /** The two blocking interrupts, which the run is waiting on. */
  pending: EngineState['approvals'][number] | null;
  queueLength: number;
  /**
   * The tenant-wide `/approvals` poll the attention line reads. `pending` is the
   * last list that arrived, which may be older than `error` says — see
   * `PendingApprovals` before treating an empty list as "nothing waiting".
   */
  tenantApprovals: PendingApprovals;
  /** When this tab saw the current or last run start and stop. */
  runClock: RunClock;
  onDecide(status: 'approved' | 'denied', editedArgs?: Record<string, unknown>): Promise<void>;
  /** Take down a lapsed approval the harness has already denied. */
  onDismiss(): void;
  uiPrompt: EngineState['uiPrompt'];
  uiResolving: boolean;
  onUiRespond(value: unknown): void;
  onUiCancel(): void;

  /** This thread. */
  threadId: string;
  /**
   * Threads with a run in flight in this tab — the one on screen while it
   * streams, and any the operator switched away from mid-run, which keep going
   * in the background until they settle. A new set whenever membership changes.
   */
  runningThreads: ReadonlySet<string>;
  /**
   * Threads whose engine in this tab holds an open approval or an agent's
   * question — including a run kept going in the background. Narrower than the
   * `/approvals` poll (only what this tab's engines adopted) but the only record
   * of a question, which `/approvals` never lists.
   */
  blockedThreads: ReadonlySet<string>;
  /**
   * Another client drives this thread and this tab holds only an observer lease:
   * the composer and every driving action are read-only until the keeper takes
   * the thread over, which it does on its own once the thread is free.
   */
  watching: boolean;
  /** Who drives it while `watching`, as far as the banner's wording needs. */
  driver: Driver;
  labels: Record<string, string>;
  /** Edited messages' versions, by user event id (`branchPoints`). */
  branches?: Map<string, BranchPoint>;
  /** Rewind to the end of another version's thread. */
  switchBranch?: (tipEventId: string) => void;
  labelTurn(eventId: string, label: string | null): void;
  /** Ratings of assistant turns, keyed by server event id. */
  feedback: Record<string, TurnFeedback>;
  /** Rate a turn, or clear it; a thumbs-down with a note can also become an eval case. */
  rateTurn(
    turnId: string,
    rating: 'up' | 'down' | null,
    opts?: { note?: string; evalDataset?: string },
  ): Promise<void>;
  send(text: string, attachments?: ImageAttachment[], mode?: 'stream' | 'background'): void;
  submit(message: PromptInputMessage, mode?: 'stream' | 'background'): Promise<void>;
  /** A message the harness refused on the lease, for the composer to take back. */
  kept: KeptMessage | null;
  /** The composer has the kept message: forget it, so a remount does not restore it twice. */
  takeKept(): void;
  /**
   * Put `text` in the composer, ahead of anything already typed, without sending it.
   * A denied call's "Ask again": the operator reads, edits and sends it themselves.
   */
  draftMessage(text: string): void;
  /** Messages written mid-run, held until the thread is free or the operator steers with one. */
  queue: MessageQueue;
  /** Steer the run in flight with one queued message. Cancels the run's remaining tool calls. */
  steerQueued(id: string): void;
  stopRun(): void;
  regenerate(): void;
  rewindTo(eventId: string): void;
  /** Replace a sent user message and run from it; the original stays on another branch. */
  editTurn(turnId: string, text: string): Promise<void>;
  onSlashCommand(cmd: SlashCommand): void;

  /** The thread index behind the history rail. */
  threads: ThreadMeta[];
  /**
   * Whether the harness's half of `threads` is current. `error` is the latest
   * failed `GET /chat/sessions`, null once one answers; `rememberedAt` is when
   * the index this tab fell back to was read, or null when it has none and the
   * list is this browser's alone. Optional, so a test's partial shell need not
   * spell it out.
   */
  threadIndex?: ThreadIndexStatus;
  selectThread(id: string): void;
  newThread(): void;
  deleteThread(id: string): void;
  renameThread(id: string, name: string): void;
  forkThread(id: string): void;
  compactThread(id: string): void;
  exportThread(id: string): void;

  /** Shell chrome the header sets and a route reads. */
  manifest: string;
  setManifest: Dispatch<SetStateAction<string>>;
  manifestOptions: string[];
  /**
   * What `/v1/models` said about each manifest, in the harness's order. Empty
   * until it answers; `manifestOptions` still carries the current manifest then.
   */
  manifestEntries: ManifestEntry[];
  /**
   * Re-read the canary rollout badge. `/harness/manifests` can change the thing
   * the header reports, so leaving that panel is what refreshes it.
   */
  refreshCanary: () => void;
  /**
   * The thread's thinking level, which the composer's picker shows and sets.
   * Session state on the harness, hydrated from the snapshot; `chooseThinking`
   * writes it there and reads the thread at call time, so a composer holding a
   * stale copy still sets it on the thread on screen.
   */
  thinkingLevel: ThinkingLevel;
  thinkingLevels: readonly ThinkingLevel[];
  chooseThinking(level: ThinkingLevel): void;
  /**
   * The thread's stored permission mode, null for the manifest's default: from
   * the snapshot, or an approved plan mid-run. `choosePermissionMode` stores a new
   * one on the thread on screen, from its next run; only `default` and `plan` are
   * offered, because those are the two every agent honours.
   */
  permissionMode: string | null;
  choosePermissionMode(mode: 'default' | 'plan'): void;
  /**
   * The output style stored on the thread on screen (`POST /chat/style`), or null for
   * the agent's default — from the snapshot, or just set. Stored, not resolved: a name
   * the selected agent does not declare reads as its default, which the picker shows.
   * `chooseOutputStyle` sets it on the thread on screen, checked against the agent
   * selected for the next message, from the next run.
   */
  outputStyle: string | null;
  chooseOutputStyle(style: string | null): void;
  /**
   * The last `/ask` on the thread on screen and its answer (`POST /chat/ask`), or null. Never a
   * turn: the harness adds nothing to the thread, so the transcript must not either.
   */
  sideQuestion: SideQuestion | null;
  /** Ask about the thread on screen; resolves once the question is under way. */
  askAboutThread(question: string): Promise<void>;
  dismissSideQuestion(): void;
  /**
   * How much of the harness this tab shows (`ViewLevel`). `everyday` is the daily
   * surface: the conversation, its threads and workspace, and whatever waits on a
   * person. `harness` adds the operator's surfaces; `debug` adds the plumbing.
   */
  view: ViewLevel;
  setView: (next: ViewLevel) => void;
  /**
   * Harness view, at either level above everyday: the run instrument, every
   * harness page, the header's agent and canary, the context meter and each
   * reply's spend. These are features, not diagnostics.
   */
  harnessView: boolean;
  /**
   * Debug, the top level: the instrument's Debug tab, the ids under turns and
   * tool cards, tool I/O open with every plan call, and the harness's own wording.
   */
  debug: boolean;
  /** What this tab believes, read once, for the Debug tab and its report. */
  inspectClient: () => ClientDiagnostics;
  harnessReachable: boolean;
  historyOpen: boolean;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
  inspectorOpen: boolean;
  setInspectorOpen: Dispatch<SetStateAction<boolean>>;
  /**
   * Open something in the side pane on this thread — from `/harness` too, where
   * it goes to the thread first. Optional, so a test's partial shell leaves the
   * pane's Open controls out rather than offering ones that do nothing.
   */
  openInPane?: (item: PaneItemInput) => void;
  /**
   * Tell the agent the operator changed a workspace file (`POST
   * /chat/workspace/edited`). Optional for the same reason as `openInPane`.
   */
  tellAgentEdited?: (edit: {
    path: string;
    op?: 'write' | 'delete' | 'rename';
    bytes?: number;
    /** A rename's destination. */
    toPath?: string;
  }) => Promise<EditNotice>;
  /**
   * Show a note the harness recorded straight into the log — a harness save on
   * an idle thread, which tells the agent itself (`/chat/workspace/write`).
   */
  showRecordedNote?: () => void;
}

/**
 * What came of telling the agent about an edit. `queued`: a run is going and
 * reads it before its next step. `recorded`: it is in the thread for the next
 * run. The rest are reasons the agent was not told: the thread has never run,
 * another tab drives it, the harness predates the route, or the request failed.
 */
export type EditNotice =
  | 'queued'
  | 'recorded'
  | 'no-thread'
  | 'watching'
  | 'unsupported'
  | 'failed';

/** One engine in the pool, as the Debug tab reads it. */
export interface EngineReport {
  threadId: string;
  foreground: boolean;
  pins: number;
  phase: string;
  streaming: boolean;
  reattaching: boolean;
  approvals: number;
  question: boolean;
  error: string | null;
  diagnostics: EngineDiagnostics;
}

/**
 * The client's beliefs about the harness and its runs, in one value. Built on
 * demand from state the shell, the pool and the lease keeper already hold.
 */
export interface ClientDiagnostics {
  at: number;
  threadId: string;
  holderId: string;
  lease: { mode: 'exclusive' | 'shared' | null; heldByOther: boolean; token: string | null };
  manifest: string;
  /** The agent the newest turn ran under, from the thread index; null when unknown. */
  threadAgent: string | null;
  canary: { version: number; weight: number; onCanary: boolean } | null;
  /** The newest server event id on screen — the leaf the next message continues. */
  leaf: string | null;
  turns: number;
  harnessReachable: boolean;
  engines: EngineReport[];
}

/**
 * Epoch ms, observed by this tab. `endedAt` null with `startedAt` set means a
 * run is in flight; both null means none has run on this thread since load.
 */
export interface RunClock {
  startedAt: number | null;
  endedAt: number | null;
}

export const NO_RUN: RunClock = { startedAt: null, endedAt: null };

const ShellContext = createContext<ShellValue | null>(null);

/**
 * The same value as a store, for `useShellPick`. The value is rebuilt on every
 * shell render — per streamed frame, while a reply streams — so every `useShell()`
 * reader renders with it. A memoised component that reads only the fields it
 * names through the store renders only when one of those changes: the sidebar was
 * ~40% of render time during a reply and reads nothing that a reply changes.
 */
interface ShellStore {
  current: ShellValue;
  listeners: Set<() => void>;
}
const ShellStoreContext = createContext<ShellStore | null>(null);

/**
 * Provide the shell. The store's value is set as this renders, so anything
 * rendering in the same pass reads the new one; subscribers that did not render
 * (a memoised reader) are told once the pass commits, and re-render only if what
 * they picked changed.
 */
export function ShellProvider({ value, children }: { value: ShellValue; children?: ReactNode }) {
  const [store] = useState<ShellStore>(() => ({ current: value, listeners: new Set() }));
  store.current = value;
  useLayoutEffect(() => {
    for (const l of store.listeners) l();
  });
  return createElement(
    ShellContext.Provider,
    { value },
    createElement(ShellStoreContext.Provider, { value: store }, children),
  );
}

const subscribeTo = (store: ShellStore) => (l: () => void) => {
  store.listeners.add(l);
  return () => {
    store.listeners.delete(l);
  };
};
const subscribers = new WeakMap<ShellStore, (l: () => void) => () => void>();

/**
 * Only the named fields of the shell, re-rendering only when one of them changes
 * (compared with `Object.is`). For a memoised component: an unmemoised one renders
 * with its parent anyway. A field that is rebuilt on every render — an inline
 * object or closure — defeats it, so pick only stable ones; the shell's verbs are
 * `useCallback`s and its state is React state.
 */
export function useShellPick<K extends keyof ShellValue>(...keys: K[]): Pick<ShellValue, K> {
  const picked = useOptionalShellPick(...keys);
  if (!picked) throw new Error('useShellPick must be used inside the app shell route');
  return picked;
}

const noStore = () => () => {};
const nothing = () => null;

/** `useShellPick` for a piece also rendered outside the shell (tests, previews): null there. */
export function useOptionalShellPick<K extends keyof ShellValue>(
  ...keys: K[]
): Pick<ShellValue, K> | null {
  const store = useContext(ShellStoreContext);
  let subscribe = store ? subscribers.get(store) : noStore;
  if (store && !subscribe) {
    subscribe = subscribeTo(store);
    subscribers.set(store, subscribe);
  }
  const last = useRef<Pick<ShellValue, K> | null>(null);
  const pick = store
    ? () => {
        const next = store.current;
        const prev = last.current;
        if (prev && keys.every((k) => Object.is(prev[k], next[k]))) return prev;
        const picked = {} as Pick<ShellValue, K>;
        for (const k of keys) picked[k] = next[k];
        last.current = picked;
        return picked;
      }
    : nothing;
  return useSyncExternalStore(subscribe ?? noStore, pick, pick);
}

/**
 * Read the shell. Throws rather than returning a default, because every default
 * here would be a lie a component would render — an empty transcript, a thread
 * that is not the one on screen — instead of failing where the mistake is.
 */
/** The shell when there is one: for pieces also rendered outside it, in tests and previews. */
export function useOptionalShell(): ShellValue | null {
  return useContext(ShellContext);
}

export function useShell(): ShellValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error('useShell must be used inside the app shell route');
  return value;
}
