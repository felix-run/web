import { Route, Routes } from 'react-router';
import { AppShell } from '@/app-shell';
import { Workbench } from '@/routes/workbench';

/**
 * The addresses this client answers to.
 *
 * `AppShell` is a layout route, not a wrapper by convention: it holds the
 * engine, the thread, the approval poll and presence, and renders whichever
 * route matched into its `<Outlet/>`. That is the load-bearing part — a run is
 * alive for as long as the tab is, so nothing that owns one may be mounted
 * inside a route that a navigation can unmount.
 *
 * Declarative routing only. There are no loaders or actions here and there
 * should not be: every fetch this app makes goes through `src/api.ts` and the
 * engine, which is what `check-api-drift` walks.
 */
export default function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
        {/* `/` mints a thread and replaces itself with `/t/:threadSuffix`, so
            both of these render the same workbench and only one of them is ever
            in the address bar for long. */}
        <Route path="/" element={<Workbench />} />
        <Route path="/t/:threadSuffix" element={<Workbench />} />
      </Route>
    </Routes>
  );
}
