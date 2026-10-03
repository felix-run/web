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

export default function App() {
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
