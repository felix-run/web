import { useCallback, useEffect, useRef, useState } from 'react';
import type { ViewLevel } from '@/app/shell-context';
import { announceViewChange } from '@/lib/navigation/view-change';

/**
 * The View level, per browser. It was one Debug switch (`felix.debug`), and
 * before that Verbose (`felix.verbose`) while it only opened tool I/O; a browser
 * that had either on starts at `debug`, so nobody loses what they had, and the
 * old keys are dropped the first time the new one is written.
 */
const VIEW_KEY = 'felix.view';
const LEGACY_DEBUG_KEY = 'felix.debug';
const LEGACY_VERBOSE_KEY = 'felix.verbose';
/** The View menu's levels, in the order the radio group lists them. */
export const VIEW_OPTIONS: ReadonlyArray<{ value: ViewLevel; label: string; hint: string }> = [
  { value: 'everyday', label: 'Everyday', hint: 'The conversation and what waits on you' },
  { value: 'harness', label: 'Harness view', hint: 'Run instrument, every harness page, spend' },
  { value: 'debug', label: 'Harness + debug', hint: 'Adds the Debug tab, ids and tool I/O' },
];
export const isViewLevel = (v: unknown): v is ViewLevel =>
  v === 'everyday' || v === 'harness' || v === 'debug';
function readBool(key: string, fallback: boolean): boolean {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  return raw === '1' || raw === 'true';
}

function readView(): ViewLevel {
  try {
    const stored = localStorage.getItem(VIEW_KEY);
    if (isViewLevel(stored)) return stored;
    const legacy =
      localStorage.getItem(LEGACY_DEBUG_KEY) !== null
        ? readBool(LEGACY_DEBUG_KEY, false)
        : readBool(LEGACY_VERBOSE_KEY, false);
    return legacy ? 'debug' : 'everyday';
  } catch {
    return 'everyday';
  }
}

export function useShellPreferences() {
  const [view, setView] = useState(readView);
  const harnessView = view !== 'everyday';
  const debug = view === 'debug';
  /**
   * The level debug was turned on from, so turning it off — the badge, `/debug` —
   * goes back there: from everyday, a look at the ids is not a move to harness view.
   */
  const beforeDebugRef = useRef<ViewLevel>(view === 'debug' ? 'harness' : view);
  // Every setter says so first, while the old level is still on screen: see `view-change.ts`.
  const chooseView = useCallback((next: ViewLevel) => {
    announceViewChange();
    setView((v) => {
      if (next === 'debug' && v !== 'debug') beforeDebugRef.current = v;
      return next;
    });
  }, []);
  // From the level as it stands, not as a render saw it: the composer can hold a
  // command handler from an earlier render, and `/view` from that one stepped twice.
  const stepView = useCallback(() => {
    announceViewChange();
    setView((v) => {
      const at = VIEW_OPTIONS.findIndex((o) => o.value === v);
      const next = VIEW_OPTIONS[(at + 1) % VIEW_OPTIONS.length]!.value;
      if (next === 'debug') beforeDebugRef.current = v;
      return next;
    });
  }, []);
  const toggleDebug = useCallback(() => {
    announceViewChange();
    setView((v) => {
      if (v === 'debug') return beforeDebugRef.current;
      beforeDebugRef.current = v;
      return 'debug';
    });
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view);
      localStorage.removeItem(LEGACY_DEBUG_KEY);
      localStorage.removeItem(LEGACY_VERBOSE_KEY);
    } catch {
      // Storage blocked: the level lasts for this page.
    }
  }, [view]);
  return { view, harnessView, debug, chooseView, stepView, toggleDebug };
}
