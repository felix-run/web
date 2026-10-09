/**
 * One section's data, and only the visible one.
 *
 * With tabs rather than chat-ui's stack of disclosures, exactly one section is
 * on screen — so the terminal costs one poll where the browser panel costs one
 * per expanded section. That is the strongest practical argument for the tab
 * strip over porting the disclosure stack.
 *
 * Approvals is the exception and deliberately so: it reads the queue the engine
 * already keeps, because that queue is fed by the `/approvals` poll that runs
 * whether or not anyone is looking. An unwatched run is the case that poll
 * exists to serve, and it must not become conditional on an overlay being open.
 */

import type {
  DocumentHit,
  DocumentRecord,
  FelixClient,
  PendingApproval,
  ThreadMeta,
} from '@felix/client';
import { useMemo } from 'react';
import type { Config } from './config.js';
import { explainError } from './errors.js';
import type { SectionKey } from './inspector.js';
import { POLL_MS } from './inspector.js';
import { usePoll } from './poll.js';
import type { Theme } from './theme.js';
import {
  activityRows,
  approvalRows,
  documentRows,
  EMPTY,
  memoryRows,
  type PanelState,
  planRows,
  skillRows,
  threadSpendRows,
  toolRows,
  USAGE_WINDOW_MS,
  usageRows,
} from './ui/inspector.js';

/** Completes "Could not …" — the verb phrase `describeError` writes around. */
function describeSection(section: SectionKey): string {
  switch (section) {
    case 'activity':
      return 'read the activity feed';
    case 'plans':
      return 'read the plans';
    case 'tools':
      return 'read the tool metrics';
    case 'usage':
      return 'read the spend by thread';
    case 'memory':
      return 'read what the agent remembers';
    case 'documents':
      return 'read the document corpus';
    default:
      return 'read that';
  }
}

/** Rows shown at once. The panel scrolls; the request should still be bounded. */
const LIMIT = 50;

export function usePanel(opts: {
  client: FelixClient;
  section: SectionKey;
  open: boolean;
  query: string;
  /** Bumped by `r` to re-read now rather than waiting out the interval. */
  tick: number;
  approvals: PendingApproval[];
  skills: { declared: string[]; active: string[] } | null;
  /** For naming a thread by its title, and marking the one on screen. */
  threads: ThreadMeta[];
  threadId: string;
  theme: Theme;
  config: Config;
}): PanelState {
  const {
    client,
    section,
    open,
    query,
    tick,
    approvals,
    skills,
    threads,
    threadId,
    theme,
    config,
  } = opts;

  // Only the visible section is enabled, so only one request is in flight.
  const on = (key: SectionKey) => open && section === key;

  const activity = usePoll(() => client.listAudit({ limit: LIMIT }), {
    enabled: on('activity'),
    intervalMs: POLL_MS,
  });
  const plans = usePoll(() => client.listPlans(LIMIT), {
    enabled: on('plans'),
    intervalMs: POLL_MS,
  });
  const tools = usePoll(() => client.getToolMetrics(), {
    enabled: on('tools'),
    intervalMs: POLL_MS,
  });
  // Spend by thread over the last day — "what did that run cost", the question
  // the raw meter could not answer because no row named its thread. A harness
  // older than the column answers 404, and the tab falls back to the raw rows
  // rather than showing every thread as free.
  const usage = usePoll(
    async () => {
      const byThread = await client.listUsageByThread({
        since_ms: Date.now() - USAGE_WINDOW_MS,
        limit: LIMIT,
      });
      if (byThread) return { kind: 'threads' as const, items: byThread.items };
      const page = await client.listUsage({ limit: LIMIT });
      return { kind: 'rows' as const, items: page.items };
    },
    { enabled: on('usage'), intervalMs: POLL_MS },
  );
  const memory = usePoll(
    () =>
      query.trim()
        ? client.searchMemories(query.trim(), { limit: LIMIT })
        : client.listMemories({ limit: LIMIT }),
    { enabled: on('memory'), intervalMs: POLL_MS },
  );

  // Same shape as memory: the section's own filter searches when it has text and
  // lists when it does not, so `/` means one thing across both.
  // Explicitly a union: unlike `MemoryHit`, a `DocumentHit` is not assignable to
  // the list row — it has no `chunks`, because a chunk is not a document — so
  // inference would otherwise pin this to whichever branch it read first.
  const documents = usePoll<Array<DocumentRecord | DocumentHit>>(
    () =>
      query.trim()
        ? client.searchDocuments(query.trim(), { limit: LIMIT })
        : client.listDocuments({ limit: LIMIT }),
    { enabled: on('documents'), intervalMs: POLL_MS },
  );

  return useMemo(() => {
    const empty = EMPTY[section] ?? '';
    const of = <T>(p: { data: T | undefined; error: unknown; loading: boolean }) => ({
      error: p.error ? explainError(p.error, describeSection(section), config) : null,
      loading: p.loading,
    });

    switch (section) {
      case 'activity': {
        const { head, rows } = activityRows(activity.data ?? [], theme);
        return { ...of(activity), head, rows, empty };
      }
      case 'approvals': {
        const { head, rows } = approvalRows(approvals, theme);
        return { error: null, loading: false, head, rows, empty };
      }
      case 'plans': {
        const { head, rows } = planRows(plans.data ?? []);
        return { ...of(plans), head, rows, empty };
      }
      case 'tools': {
        const { head, rows } = toolRows(tools.data?.tools ?? [], theme);
        return { ...of(tools), head, rows, empty };
      }
      case 'usage': {
        const { head, rows } =
          usage.data?.kind === 'threads'
            ? threadSpendRows(usage.data.items, { threads, current: threadId, theme })
            : usageRows(usage.data?.items ?? []);
        return { ...of(usage), head, rows, empty };
      }
      case 'memory': {
        const { head, rows } = memoryRows(memory.data ?? []);
        return { ...of(memory), head, rows, empty };
      }
      case 'documents': {
        const { head, rows } = documentRows(documents.data ?? []);
        return { ...of(documents), head, rows, empty };
      }
      case 'skills': {
        const { head, rows } = skillRows(skills);
        return { error: null, loading: false, head, rows, empty };
      }
    }
    // `tick` is a dependency rather than a caller: bumping it re-derives, and
    // the refresh itself is the poll hooks' own `refresh`.
  }, [
    section,
    activity,
    plans,
    tools,
    usage,
    memory,
    documents,
    approvals,
    skills,
    threads,
    threadId,
    theme,
    config,
    tick,
  ]);
}
