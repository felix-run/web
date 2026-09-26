import { type SetStateAction, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMediaQuery } from '@/hooks/useMediaQuery';

/**
 * Where each zone stops being a column and becomes a drawer. The reasoning for
 * the numbers, and for the order the zones yield in, is in `routes/workbench.tsx`;
 * they live here because the shell's header has to know them too — a toggle
 * that reports a rail as open while it is hidden is a toggle that lies.
 */
export const WORKSPACE_INLINE = '(min-width: 1024px)';
export const INSTRUMENT_INLINE = '(min-width: 1280px)';

const HISTORY_KEY = 'felix.historyOpen';
const INSPECTOR_KEY = 'felix.inspectorOpen';

type Zone = 'workspace' | 'instrument';

function readBool(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === '1' || raw === 'true';
}

function resolve(next: SetStateAction<boolean>, prev: boolean): boolean {
  return typeof next === 'function' ? next(prev) : next;
}

export interface Rails {
  /** Whether the workspace is on screen — inline or as the drawer, whichever this width gets. */
  historyOpen: boolean;
  setHistoryOpen: (next: SetStateAction<boolean>) => void;
  /** Whether the run instrument is on screen, same rule. */
  inspectorOpen: boolean;
  setInspectorOpen: (next: SetStateAction<boolean>) => void;
  /**
   * Show the instrument only where that costs nothing — where it is a column.
   * For opens nobody asked for (a verbose run's first tool call): at a narrow
   * width the instrument is a modal, and a modal the run opens on its own takes
   * the transcript away mid-reply.
   */
  revealInspector: () => void;
}

/**
 * The two side zones' open state, split into the two things it used to conflate.
 *
 * The **inline preference** is a desktop layout choice and is persisted under
 * `felix.historyOpen` / `felix.inspectorOpen`. The **drawer** is a momentary
 * overlay and is not: it starts closed on every load and nothing it does is
 * written down. One boolean per zone served both until a thread at 1100px loaded
 * behind a modal "This run" drawer because the flag had been set on a wide
 * monitor — and closing it there wrote `0`, which silently collapsed the rail
 * back on the monitor.
 *
 * At most one drawer is open. Both are modal, and on a phone the second used to
 * stack over the first with the transcript under both.
 *
 * The setters are stable and read the breakpoints through a ref, because the
 * engine's callbacks are built once and call them long after the render that
 * created them.
 */
export function useRails(workspaceDefault: () => boolean): Rails {
  const workspaceInline = useMediaQuery(WORKSPACE_INLINE);
  const instrumentInline = useMediaQuery(INSTRUMENT_INLINE);
  const inline = useRef<Record<Zone, boolean>>({ workspace: false, instrument: false });
  inline.current = { workspace: workspaceInline, instrument: instrumentInline };

  const [historyPref, setHistoryPref] = useState(() => readBool(HISTORY_KEY, workspaceDefault()));
  const [inspectorPref, setInspectorPref] = useState(() => readBool(INSPECTOR_KEY, false));
  const [drawer, setDrawer] = useState<Zone | null>(null);

  // A drawer belongs to the width it was opened at. Once its zone fits inline
  // the stored preference decides, and the drawer must not stay latched open to
  // reappear on the next narrowing. Going narrow needs no counterpart: `drawer`
  // is only ever set by an explicit open, so nothing pops up on a resize.
  useEffect(() => {
    if (workspaceInline) setDrawer((d) => (d === 'workspace' ? null : d));
  }, [workspaceInline]);
  useEffect(() => {
    if (instrumentInline) setDrawer((d) => (d === 'instrument' ? null : d));
  }, [instrumentInline]);

  const { setHistoryOpen, setInspectorOpen } = useMemo(() => {
    const setter =
      (zone: Zone, key: string, setPref: typeof setHistoryPref) =>
      (next: SetStateAction<boolean>) => {
        if (inline.current[zone]) {
          setPref((prev) => {
            const value = resolve(next, prev);
            // Written here rather than from an effect on the preference, so the
            // store changes only when an operator changes the rail — never on
            // mount, where it would freeze the "open if there are threads"
            // default into an answer nobody gave. Idempotent, so StrictMode's
            // second run of this updater is harmless.
            localStorage.setItem(key, value ? '1' : '0');
            return value;
          });
          return;
        }
        // Opening one drawer replaces the other; closing one leaves the other be.
        setDrawer((d) => (resolve(next, d === zone) ? zone : d === zone ? null : d));
      };
    return {
      setHistoryOpen: setter('workspace', HISTORY_KEY, setHistoryPref),
      setInspectorOpen: setter('instrument', INSPECTOR_KEY, setInspectorPref),
    };
  }, []);

  const revealInspector = useCallback(() => {
    if (inline.current.instrument) setInspectorOpen(true);
  }, [setInspectorOpen]);

  return {
    historyOpen: workspaceInline ? historyPref : drawer === 'workspace',
    setHistoryOpen,
    inspectorOpen: instrumentInline ? inspectorPref : drawer === 'instrument',
    setInspectorOpen,
    revealInspector,
  };
}
