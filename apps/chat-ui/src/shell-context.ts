import type { BranchPoint, ChatEngine, ManifestEntry, ThreadMeta } from '@felix/client';
import { createContext, type Dispatch, type SetStateAction, useContext } from 'react';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import type { KeptMessage } from '@/components/chat/multimodal-input';
import type { SlashCommand } from '@/components/chat/slash-commands';
import type { Driver } from '@/components/chat/watching-banner';
import type { SkillState } from '@/components/inspector/primitives';
import type { MessageQueue } from '@/hooks/use-message-queue';
import type { PendingApprovals } from '@/hooks/use-pending-approvals';
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
  skills: SkillState | null;

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
  verbose: boolean;
  harnessReachable: boolean;
  historyOpen: boolean;
  setHistoryOpen: Dispatch<SetStateAction<boolean>>;
  inspectorOpen: boolean;
  setInspectorOpen: Dispatch<SetStateAction<boolean>>;
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

export const ShellProvider = ShellContext.Provider;

/**
 * Read the shell. Throws rather than returning a default, because every default
 * here would be a lie a component would render — an empty transcript, a thread
 * that is not the one on screen — instead of failing where the mistake is.
 */
export function useShell(): ShellValue {
  const value = useContext(ShellContext);
  if (!value) throw new Error('useShell must be used inside the app shell route');
  return value;
}
