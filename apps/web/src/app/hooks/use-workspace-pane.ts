import type { ManifestEntry, ThreadMeta } from '@felix/client';
import type { RefObject } from 'react';
import { type SetStateAction, useCallback, useEffect, useMemo, useRef } from 'react';
import type { Turn } from '@/api/types';
import { useMediaQuery } from '@/hooks/use-media-query';
import { INSTRUMENT_INLINE, useRails } from '@/hooks/use-rails';
import { addFilesTab, anyUnsaved, setPaneShown, usePaneState } from '@/lib/navigation/side-pane';
import { landedPaths } from '@/lib/workspace/changes';

interface WorkspacePaneOptions {
  threadId: string;
  threadIdRef: RefObject<string>;
  turns: Turn[];
  streaming: boolean;
  harnessView: boolean;
  threads: ThreadMeta[];
  manifest: string;
  manifestEntries: ManifestEntry[];
}

export function useWorkspacePane({
  threadId,
  threadIdRef,
  turns,
  streaming,
  harnessView,
  threads,
  manifest,
  manifestEntries,
}: WorkspacePaneOptions) {
  // Workspace open by default wherever it fits inline: it is the subject (the
  // folder, and the only door to other threads), and it used to open only once a
  // profile had threads, so a first visit started with the subject hidden.
  // The instrument starts open only where all three zones fit at their own
  // widths, and not over a thread with no turns (`useRails`). What is persisted
  // is the *inline* preference — a drawer at a narrow width starts closed and is
  // never written down; `useRails` says why.
  //
  // Called here, below the engine's state, because the default reads `turns`.
  // The pool's `onToolStart` above names `revealInspector` before this line;
  // it runs only once a tool starts, long after this render has passed it.
  const {
    historyOpen,
    setHistoryOpen,
    inspectorOpen: instrumentWanted,
    setInspectorOpen: setInstrumentWanted,
    revealInspector: revealInstrument,
  } = useRails({ emptyThread: turns.length === 0, enabled: harnessView });

  // The side pane takes the instrument's zone where the instrument is a column
  // (`routes/workbench.tsx`). The instrument's preference is left as it was, so
  // closing the pane brings it back exactly as it stood; while the pane holds
  // the zone the instrument reads closed, and opening it hands the zone back
  // with the pane's tabs kept. Below 1280 the instrument is a drawer over
  // everything and the two do not compete.
  const instrumentInline = useMediaQuery(INSTRUMENT_INLINE);
  const pane = usePaneState(threadId);
  const paneHasItems = pane.items.length > 0;
  const paneHoldsZone = instrumentInline && pane.shown && paneHasItems;
  const paneZone = useRef({ holds: paneHoldsZone, hasItems: paneHasItems, inline: false });
  paneZone.current = { holds: paneHoldsZone, hasItems: paneHasItems, inline: instrumentInline };
  const inspectorOpen = instrumentWanted && !paneHoldsZone;
  const setInspectorOpen = useCallback(
    (next: SetStateAction<boolean>) => {
      const { holds, hasItems, inline } = paneZone.current;
      if (holds) {
        if (typeof next === 'function' ? next(false) : next) {
          setPaneShown(threadIdRef.current, false);
          setInstrumentWanted(true);
        }
        return;
      }
      setInstrumentWanted((was) => {
        const open = typeof next === 'function' ? next(was) : next;
        // Closing the instrument over a pane it had displaced gives the zone back.
        if (inline && hasItems && was && !open) setPaneShown(threadIdRef.current, true);
        return open;
      });
    },
    [setInstrumentWanted],
  );
  // A draft lives in this tab's session storage, which a closed tab takes with it.
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (anyUnsaved()) e.preventDefault();
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);
  // A run's first tool call must not take the zone from a file being read.
  const revealInspector = useCallback(() => {
    if (!paneZone.current.holds) revealInstrument();
  }, [revealInstrument]);

  // A run writing to a file opens Files, the tree it landed in — once a thread:
  // closing Files keeps it closed for the session (`addFilesTab`). Only a write
  // seen *live* counts, so loading a thread with past writes opens nothing, and
  // only for an agent with file tools. It never takes the zone from an open
  // instrument: Files waits behind it, in front when the instrument closes.
  const writes = useMemo(() => landedPaths(turns).size, [turns]);
  const writesSeen = useRef({ threadId, writes });
  useEffect(() => {
    const seen = writesSeen.current;
    writesSeen.current = { threadId, writes };
    if (seen.threadId !== threadId || !streaming || writes <= seen.writes) return;
    const agent = threads.find((t) => t.id === threadId)?.manifest?.trim() || manifest;
    if (manifestEntries.find((m) => m.id === agent)?.workspace?.tools === 'none') return;
    addFilesTab(threadId, { show: !(instrumentInline && instrumentWanted) });
  }, [
    writes,
    threadId,
    streaming,
    threads,
    manifest,
    manifestEntries,
    instrumentInline,
    instrumentWanted,
  ]);
  return {
    historyOpen,
    setHistoryOpen,
    inspectorOpen,
    setInspectorOpen,
    pane,
    paneHasItems,
    paneZone,
    revealInspector,
  };
}
