import { QueryClient, QueryClientContext, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useContext } from 'react';

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
  client ??= new QueryClient({
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
  return client;
}

/** Drop the cache — between tests, which would otherwise read each other's answers. */
export function resetSkillQueryClient() {
  client?.clear();
  client = null;
}

/** Wraps a skill surface in the shared client, unless a host already provided one. */
export function QueryRoot({ children }: { children: ReactNode }) {
  const existing = useContext(QueryClientContext);
  if (existing) return <>{children}</>;
  return <QueryClientProvider client={skillQueryClient()}>{children}</QueryClientProvider>;
}
