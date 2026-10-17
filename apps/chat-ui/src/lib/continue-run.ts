import type { Turn } from '@/types';

/**
 * Whether "Continue run" has anything to continue, and if not, why.
 *
 * `POST /chat/continue` resumes a turn that stopped short — an abort, an error, a run that
 * died mid-tool — without a new message. It refuses the rest: `nothing_to_continue` on a
 * thread with no turn, and `already_complete` when the last event is a finished assistant
 * reply with no tool call pending. The menu offered it first on every idle thread anyway,
 * so the one item a finished thread could not use led the Session menu, and pressing it
 * spent a request on a refusal (2026-10-16).
 *
 * Read off what the client holds, which mirrors the harness's two checks: the last turn
 * that is not a note (a note is neither side of the conversation), and the phase the
 * snapshot or the stream left. Where the client cannot tell, it offers — the harness is
 * the one that decides, and a refusal there is said as it always was.
 */
export type ContinueOffer = { ok: true } | { ok: false; reason: string };

export function continueOffer(
  turns: readonly Turn[],
  phase: string,
  error: string | null,
): ContinueOffer {
  // ES2022 lib: no `findLast`.
  const last = [...turns].reverse().find((t) => t.role !== 'note');
  if (!last) return { ok: false, reason: 'Nothing has run on this thread yet.' };
  if (phase === 'aborted' || error) return { ok: true };
  if (last.role === 'user') return { ok: true };
  const pending = last.tools?.some((t) => !t.done) ?? false;
  const unanswered = !last.content.trim() && !last.tools?.length;
  if (pending || unanswered || last.stop) return { ok: true };
  return { ok: false, reason: 'The last reply finished; there is nothing to pick up.' };
}
