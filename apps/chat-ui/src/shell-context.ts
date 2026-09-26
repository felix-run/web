import type { ChatEngine, ThreadMeta } from '@felix/client';
import { createContext, type Dispatch, type SetStateAction, useContext } from 'react';
import type { PromptInputMessage } from '@/components/ai-elements/prompt-input';
import type { SlashCommand } from '@/components/chat/slash-commands';
import type { SkillState } from '@/components/inspector/primitives';
import type { PendingApprovals } from '@/hooks/use-pending-approvals';
import type { ImageAttachment } from '@/types';

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
  error: EngineState['error'];
  /** The engine's phase, or null while it is resting; a chip renders it. */
  sessionPhase: string | null;
  skills: SkillState | null;

  /** The two blocking interrupts, which the run is waiting on. */
  pending: EngineState['approvals'][number] | null;
  queueLength: number;
  /**
   * The whole queue, oldest first. The banner draws only the head; the rest are
   * here so a surface listing `/approvals` rows can recover what only a frame
   * carries — the `reason` — for an approval the banner is not drawing.
   */
  approvalQueue: EngineState['approvals'];
  /**
   * Approval ids the transcript banner owns. Every other surface that lists
   * `/approvals` counts these without re-offering them — see `AttentionLine`'s
   * `handled` for why deciding elsewhere means deciding with less in front of you.
   */
  bannerOwned: string[];
  /**
   * The tenant-wide `/approvals` poll the attention line reads. `pending` is the
   * last list that arrived, which may be older than `error` says — see
   * `PendingApprovals` before treating an empty list as "nothing waiting".
   */
  tenantApprovals: PendingApprovals;
  /** When this tab saw the current or last run start and stop. */
  runClock: RunClock;
  onDecide(status: 'approved' | 'denied', editedArgs?: Record<string, unknown>): Promise<void>;
  uiPrompt: EngineState['uiPrompt'];
  uiResolving: boolean;
  onUiRespond(value: unknown): void;
  onUiCancel(): void;

  /** This thread. */
  threadId: string;
  labels: Record<string, string>;
  labelTurn(eventId: string, label: string | null): void;
  send(text: string, attachments?: ImageAttachment[], mode?: 'stream' | 'background'): void;
  submit(message: PromptInputMessage, mode?: 'stream' | 'background'): void;
  stopRun(): void;
  regenerate(): void;
  rewindTo(eventId: string): void;
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
   * Re-read the canary rollout badge. `/harness/manifests` can change the thing
   * the header reports, so leaving that panel is what refreshes it.
   */
  refreshCanary: () => void;
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
