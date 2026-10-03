import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import { AppShell } from '@/app-shell';
import { PanelBoundary } from '@/components/harness/panel';
import { HARNESS_DESTINATIONS, HarnessLayout } from '@/routes/harness';
import { Workbench } from '@/routes/workbench';

/**
 * The addresses this client answers to.
 *
 * `AppShell` is a layout route, not a wrapper by convention: it holds the
 * engine, the thread, the approval poll and presence, and renders whichever
 * route matched into its `<Outlet/>`. That is the load-bearing part — a run is
 * alive for as long as the tab is, so nothing that owns one may be mounted
 * inside a route that a navigation can unmount. It is what lets `/harness` be a
 * real address rather than a modal: you can walk away from the transcript and
 * come back to a run that never stopped.
 *
 * Declarative routing only. There are no loaders or actions here and there
 * should not be: every fetch this app makes goes through `src/api.ts` and the
 * engine, which is what `check-api-drift` walks.
 */
/**
 * `/` is a fresh thread.
 *
 * It mints an id and replaces the address with it, so the thread is linkable the
 * moment it exists and a reload resumes it rather than minting a second one. A
 * component rather than a redirect in the shell, because "the URL names no
 * thread" is not the same question as "the operator asked for a new one" — the
 * shell sees the first on every visit to `/harness`, and answering it by minting
 * would reset the engine and kill a live run.
 *
 * Mounting is what mints: coming back to `/` later is a new mount, so it is a
 * genuinely new thread rather than the last one again.
 */
function NewThread() {
  const [id] = useState(() => crypto.randomUUID());
  return <Navigate to={`/t/${id}`} replace />;
}

/**
 * The one TanStack Query client, made per mount of the app rather than at module
 * scope, so a test that mounts the app twice gets two caches and never reads the
 * last one's answers.
 *
 * The skill library is its only user for now; the older panels poll through
 * `usePoll`. A refusal (any 4xx) is not retried, because asking again gets the
 * same answer slower; a 5xx or a dropped connection is retried once. Focus does
 * not refetch: the library's views refetch after every write and on mount, and
 * a refetch mid-edit is exactly what the editor's baseline rule has to defend
 * against.
 */
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        refetchOnWindowFocus: false,
        retry: (count, err) => {
          const status = (err as { status?: number })?.status;
          const fromText = /:\s*(\d{3})\b/.exec(String((err as Error)?.message ?? ''))?.[1];
          const code = status ?? (fromText ? Number(fromText) : undefined);
          if (code !== undefined && code >= 400 && code < 500) return false;
          return count < 1;
        },
      },
      mutations: { retry: false },
    },
  });
}

export default function App() {
  const [queryClient] = useState(makeQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <AppRoutes />
    </QueryClientProvider>
  );
}

function AppRoutes() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        <Route path="/" element={<NewThread />} />
        <Route path="/t/:threadSuffix" element={<Workbench />} />

        {/* The nav and these routes are built from one list, so neither can gain
            an entry the other lacks. */}
        <Route path="/harness" element={<HarnessLayout />}>
          {HARNESS_DESTINATIONS.map(({ path, label, element }) => (
            <Route
              key={path}
              path={path}
              element={<PanelBoundary title={label}>{element}</PanelBoundary>}
            />
          ))}
        </Route>

        {/* An address this client does not serve is not an error worth a page:
            the workbench is what someone was looking for. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
