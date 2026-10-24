import type { ThreadMeta } from '@felix/client';
import { failing } from '@/lib/harness-glances';
import { threadLabel } from '@/lib/threads';
import type { ApprovalRequest, JobRecord } from '@/types';

/**
 * What the sidebar's Needs-you band lists: what is live, or ran with nobody
 * watching, and asks something of the operator.
 *
 * Three kinds, in this order, because it is the order of what each asks:
 *
 * - **Waiting** — a thread whose run is held on a person: an approval from the
 *   tenant-wide `/approvals` poll (positive evidence only — its `thread_id`), or
 *   an approval or question an engine in this tab holds. `/approvals` never lists
 *   a question, which is why the engines' own record counts too. Approvals that
 *   name no thread are one row of their own rather than none: they still wait.
 * - **Failing job** — a scheduled job whose last firing did not succeed, once per
 *   job however often it fires (`failing`, the Jobs glance's own reading, which
 *   clears when a run succeeds). A job runs with nobody watching, so this is the
 *   one outcome the band carries; a conversation's failed or denied turn was seen
 *   by whoever ran it, and stays a mark on its row.
 * - **Running** — a run this tab carries. It asks nothing yet, but it is what an
 *   operator came back to check on, and it is about to ask or to finish.
 *
 * A disabled job is left out: nothing about it is going to happen again until
 * someone chooses to, so it is not waiting on them.
 */
export type NeedsYouRow =
  | {
      kind: 'waiting';
      threadId: string;
      label: { text: string; isId: boolean };
      /** What it waits on, short: a tool's name, `2 approvals`, `a question`. */
      detail: string;
      /** `detail` is a tool's name — the harness's id, drawn in mono. */
      detailIsTool: boolean;
    }
  | { kind: 'unthreaded'; count: number; tool: string | null }
  | { kind: 'job'; name: string; lastRunAt: number | null }
  | { kind: 'running'; threadId: string; label: { text: string; isId: boolean }; agent: string };

/** Rows the band draws before the rest fold behind *N more*. */
export const NEEDS_YOU_VISIBLE = 3;

export function needsYouRows({
  threads,
  approvals,
  blocked,
  asking,
  running,
  jobs,
}: {
  threads: readonly ThreadMeta[];
  /** The `/approvals` poll's last list. */
  approvals: readonly Pick<ApprovalRequest, 'thread_id' | 'tool_name'>[];
  /** Threads an engine in this tab holds an approval or a question on. */
  blocked: ReadonlySet<string>;
  /** Of those, the ones held on a question. */
  asking: ReadonlySet<string>;
  running: ReadonlySet<string>;
  jobs: readonly JobRecord[] | undefined;
}): NeedsYouRow[] {
  const byId = new Map(threads.map((t) => [t.id, t]));
  const label = (id: string) => {
    const t = byId.get(id);
    return t ? threadLabel(t) : { text: id, isId: true };
  };

  const toolsByThread = new Map<string, string[]>();
  const unthreaded: string[] = [];
  for (const a of approvals) {
    // Absent and empty mean the same: no thread to attribute it to.
    if (!a.thread_id) unthreaded.push(a.tool_name);
    else toolsByThread.set(a.thread_id, [...(toolsByThread.get(a.thread_id) ?? []), a.tool_name]);
  }

  // Newest activity first within a kind; a thread the index does not hold sorts last.
  const recency = (id: string) => byId.get(id)?.updatedAt ?? 0;
  const waitingIds = [...new Set([...toolsByThread.keys(), ...blocked])].sort(
    (a, b) => recency(b) - recency(a),
  );
  const rows: NeedsYouRow[] = waitingIds.map((threadId) => {
    const tools = toolsByThread.get(threadId) ?? [];
    const [only] = tools;
    const detail =
      tools.length > 1
        ? `${tools.length} approvals`
        : only !== undefined
          ? only
          : asking.has(threadId)
            ? 'a question'
            : 'an approval';
    return {
      kind: 'waiting',
      threadId,
      label: label(threadId),
      detail,
      detailIsTool: tools.length === 1,
    };
  });
  if (unthreaded.length > 0) {
    rows.push({
      kind: 'unthreaded',
      count: unthreaded.length,
      tool: unthreaded.length === 1 ? (unthreaded[0] ?? null) : null,
    });
  }

  for (const j of [...(jobs ?? [])]
    .filter((j) => j.enabled !== false && failing(j))
    .sort((a, b) => (b.last_run_at ?? 0) - (a.last_run_at ?? 0))) {
    rows.push({ kind: 'job', name: j.name, lastRunAt: j.last_run_at ?? null });
  }

  const waiting = new Set(waitingIds);
  for (const threadId of [...running]
    .filter((id) => !waiting.has(id))
    .sort((a, b) => recency(b) - recency(a))) {
    rows.push({
      kind: 'running',
      threadId,
      label: label(threadId),
      agent: byId.get(threadId)?.manifest ?? '',
    });
  }
  return rows;
}

/** A row's identity, for React keys and the band's own roving focus. */
export function rowKey(row: NeedsYouRow): string {
  switch (row.kind) {
    case 'waiting':
    case 'running':
      return `${row.kind}:${row.threadId}`;
    case 'unthreaded':
      return 'unthreaded';
    case 'job':
      return `job:${row.name}`;
  }
}
