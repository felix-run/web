import { QueryClient, QueryClientContext, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useContext } from 'react';
import { forgetHarnessRead, reportHarnessRead } from '@/lib/harness-health';

/**
 * The skill library's TanStack Query client, created the first time a skill
 * surface mounts rather than with the app.
 *
 * The library is the only user of Query in this app — everything older polls
 * through `usePoll` — so the client and Query itself load in the lazy skills
 * chunk, and a visit that never opens the library never pays for either. One
 * client for the life of the tab, shared by the library, the skill page and
 * every chat card, so an approval in one is current in the others.
 *
 * A refusal (any 4xx) is not retried, because asking again gets the same answer
 * slower; a 5xx or a dropped connection is retried once. Focus does not
 * refetch: the views refetch after every write and on mount, and a refetch
 * mid-edit is exactly what the editor's baseline rule has to defend against.
 */
let client: QueryClient | null = null;

function skillQueryClient(): QueryClient {
  if (client) return client;
  client = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: false,
        retry: (count, err) => {
          const status = (err as { status?: number } | null)?.status;
          if (status !== undefined && status >= 400 && status < 500) return false;
          return count < 1;
        },
      },
      mutations: { retry: false },
    },
  });
  stopHealth = reportQueryHealth(client);
  return client;
}

let stopHealth: (() => void) | null = null;

/**
 * Every library read is a source for the shell's one harness-health line
 * (`lib/harness-health.ts`). A 429 across the page's six queries is one line in
 * the shell, not six boxes; a query nobody observes any more stops counting, so
 * leaving the page cannot strand the line.
 *
 * Reads only: a mutation that fails is the operator's own act and is answered
 * where it was made.
 */
export function reportQueryHealth(qc: QueryClient): () => void {
  const cache = qc.getQueryCache();
  return cache.subscribe((event) => {
    const { query } = event;
    const source = `query:${query.queryHash}`;
    if (event.type === 'removed') {
      forgetHarnessRead(source);
      return;
    }
    if (event.type === 'observerRemoved' && query.getObserversCount() === 0) {
      forgetHarnessRead(source);
      return;
    }
    if (event.type !== 'updated') return;
    const { status, error, dataUpdatedAt } = query.state;
    if (status === 'success' && error == null) {
      forgetHarnessRead(source);
    } else if (status === 'error' && query.getObserversCount() > 0) {
      reportHarnessRead(source, error, {
        lastOkAt: dataUpdatedAt || null,
        retry: () => void qc.refetchQueries({ queryKey: query.queryKey, exact: true }),
      });
    }
  });
}

/** Drop the cache — between tests, which would otherwise read each other's answers. */
export function resetSkillQueryClient() {
  stopHealth?.();
  stopHealth = null;
  client?.clear();
  client = null;
}

/** Wraps a skill surface in the shared client, unless a host already provided one. */
export function QueryRoot({ children }: { children: ReactNode }) {
  const existing = useContext(QueryClientContext);
  if (existing) return <>{children}</>;
  return <QueryClientProvider client={skillQueryClient()}>{children}</QueryClientProvider>;
}
