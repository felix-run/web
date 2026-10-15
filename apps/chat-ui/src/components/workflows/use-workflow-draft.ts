import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { checkWorkflow, saveWorkflow, WorkflowRouteError } from '@/api';
import { heightsOf } from '@/components/workflows/workflow-canvas';
import { connect, WHEN, withPositions } from '@/lib/workflow-draft';
import type { WorkflowCheck, WorkflowDefinition, WorkflowPortRef, WorkflowRecord } from '@/types';

/** How long the editor waits after an edit before asking the harness what the draft means. */
const CHECK_DELAY_MS = 250;
/** Edits closer together than this undo as one. */
const COALESCE_MS = 600;
/** How many steps back undo keeps. */
const MAX_UNDO = 100;

/** A save that lost to one made since: the workflow as it now stands, or null when it is gone. */
export interface SaveConflict {
  current: WorkflowRecord | null;
}

function conflictOf(err: unknown): SaveConflict | null {
  if (!(err instanceof WorkflowRouteError) || err.code !== 'workflow_changed') return null;
  const current = (err.detail as { current?: WorkflowRecord | null } | undefined)?.current;
  return { current: current ?? null };
}

/** Whichever of two records was saved last. */
function newest(
  a: WorkflowRecord | undefined,
  b: WorkflowRecord | null,
): WorkflowRecord | undefined {
  if (!a) return b ?? undefined;
  if (!b) return a;
  return b.updated_at > a.updated_at ? b : a;
}

/**
 * The editor's working copy of a workflow. Clean, it is the saved workflow; the first edit starts
 * a draft from it — every node placed where it is drawn — and each later edit replaces the draft.
 * The harness checks each draft a moment after it settles (`POST /workflows/-/check`), and the
 * record the canvas draws is the draft with the last check's ports and problems.
 *
 * A save names the revision the draft started from. One made since loses, and the conflict holds
 * the workflow as it now stands for the author to keep theirs over, or take.
 */
export function useWorkflowDraft(id: string, polled: WorkflowRecord | undefined) {
  // The newest record this page knows: the poll's, or one a save or a conflict handed back sooner.
  const [known, setKnown] = useState<WorkflowRecord | null>(null);
  const saved = newest(polled, known);
  const [draft, setDraft] = useState<WorkflowDefinition | null>(null);
  // The record the draft started from: its revision is what a save says it is replacing.
  const [base, setBase] = useState<WorkflowRecord | null>(null);
  // The last check, and the draft it was for: an older one still draws while the next is asked.
  const [check, setCheck] = useState<{ of: WorkflowDefinition; result: WorkflowCheck } | null>(
    null,
  );
  const [checkError, setCheckError] = useState<unknown>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<unknown>(null);
  const [conflict, setConflict] = useState<SaveConflict | null>(null);
  // Why the last wire dropped was not made, until the next edit.
  const [refusal, setRefusal] = useState<string | null>(null);

  const savedRef = useRef(saved);
  savedRef.current = saved;
  // The draft and its base as of the last render, for a save or a wire to read when it runs rather than
  // when it was bound: ⌘S fires after a blurred field has written its last edit.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const baseRef = useRef(base);
  baseRef.current = base;
  // Bumped by every edit, discard and settle: an answer that arrives for an older draft (a wire's
  // check) is dropped rather than applied to whatever the draft has become since.
  const generation = useRef(0);

  // Undo and redo: the drafts before (and, once undone, after) the one on screen. `null` is the
  // saved workflow itself, so undoing the first edit leaves nothing unsaved. Edits that land
  // within `COALESCE_MS` of the one before are one step — a word typed, not each letter.
  const past = useRef<(WorkflowDefinition | null)[]>([]);
  const future = useRef<(WorkflowDefinition | null)[]>([]);
  const lastEditAt = useRef(0);
  const [, setHistoryTick] = useState(0);
  const forget = useCallback(() => {
    past.current = [];
    future.current = [];
    lastEditAt.current = 0;
    setHistoryTick((n) => n + 1);
  }, []);

  const edit = useCallback((change: (def: WorkflowDefinition) => WorkflowDefinition) => {
    const from = savedRef.current;
    if (!from) return;
    const now = Date.now();
    if (now - lastEditAt.current > COALESCE_MS || !past.current.length) {
      past.current = [...past.current.slice(1 - MAX_UNDO), draftRef.current];
    }
    lastEditAt.current = now;
    future.current = [];
    setHistoryTick((n) => n + 1);
    generation.current += 1;
    setRefusal(null);
    setBase((b) => b ?? from);
    setDraft((d) => change(d ?? withPositions(from.definition, heightsOf(from, true))));
  }, []);

  /** Step back (or, with `redo`, forward) one edit. Back past the first is the saved workflow. */
  const travel = useCallback((redo: boolean) => {
    const from = redo ? future : past;
    const to = redo ? past : future;
    if (!from.current.length) return;
    const target = from.current[from.current.length - 1];
    from.current = from.current.slice(0, -1);
    to.current = [...to.current, draftRef.current];
    lastEditAt.current = 0;
    setHistoryTick((n) => n + 1);
    generation.current += 1;
    setRefusal(null);
    if (target === null) setBase(null);
    else setBase((b) => b ?? savedRef.current ?? null);
    setDraft(target);
  }, []);
  const undo = useCallback(() => travel(false), [travel]);
  const redo = useCallback(() => travel(true), [travel]);

  useEffect(() => {
    if (!draft) {
      setCheck(null);
      setCheckError(null);
      return;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => {
      checkWorkflow(draft, abort.signal).then(
        (result) => {
          setCheck({ of: draft, result });
          setCheckError(null);
        },
        (err: unknown) => {
          if (!abort.signal.aborted) setCheckError(err);
        },
      );
    }, CHECK_DELAY_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [draft]);

  /**
   * Wire an output into an input — unless the harness says the types cannot meet, in which case
   * nothing is wired and `refusal` says why. Asked at once, not after the edit settles: a wire
   * drawn and then taken back reads as the canvas failing, not as an answer.
   */
  const wire = useCallback(
    async (edge: { source: WorkflowPortRef; target: WorkflowPortRef }) => {
      const from = savedRef.current;
      if (!from) return;
      const current = draftRef.current ?? withPositions(from.definition, heightsOf(from, true));
      const next = connect(current, edge);
      if (next === current) return;
      const asked = generation.current;
      let result: WorkflowCheck | null = null;
      try {
        result = await checkWorkflow(next);
      } catch {
        // No answer is not a refusal: wire it, and the next check says what it means.
      }
      // Discarded, taken from a co-author, saved or edited meanwhile: the wire was asked about a
      // draft that is gone, so it is not made on whatever stands in its place.
      if (generation.current !== asked) return;
      // A data input has one wire, so a mismatch on it is this one's. `when` keeps every wire
      // into it; there, only the harness's message naming this source (`step.port: …`) is.
      const source = `${edge.source.step}.${edge.source.port}:`;
      const mismatch = result?.problems.find(
        (p) =>
          p.code === 'type_mismatch' &&
          p.step === edge.target.step &&
          p.port === edge.target.port &&
          (edge.target.port !== WHEN || p.message.startsWith(source)),
      );
      if (mismatch) {
        // The harness's message names the source already (`classify.text: string → boolean`).
        setRefusal(`Not wired into ${edge.target.step}.${edge.target.port}: ${mismatch.message}`);
        return;
      }
      edit((d) => connect(d, edge));
    },
    [edit],
  );

  // The workflow was deleted elsewhere and the author chose to save theirs anyway: the next save
  // creates it again (`If-None-Match: *`) rather than naming a revision that no longer exists.
  const [recreate, setRecreate] = useState(false);
  const recreateRef = useRef(recreate);
  recreateRef.current = recreate;
  const savingRef = useRef(false);

  const settle = useCallback(
    (record: WorkflowRecord) => {
      forget();
      generation.current += 1;
      setKnown(record);
      setDraft(null);
      setBase(null);
      setRecreate(false);
      setConflict(null);
      setSaveError(null);
      setRefusal(null);
    },
    [forget],
  );

  const put = useCallback(
    async (definition: WorkflowDefinition, over: WorkflowRecord | null) => {
      if (savingRef.current) return;
      savingRef.current = true;
      setSaving(true);
      setSaveError(null);
      try {
        const record = await saveWorkflow(
          id,
          definition,
          over ? { revision: over.revision } : { create: true },
        );
        if (draftRef.current === definition) {
          settle(record);
        } else {
          // Edited while the save was in flight: what was saved is the new base, and the edits
          // made since stay a draft over it rather than vanishing with the one that was sent.
          setKnown(record);
          setBase(record);
          setRecreate(false);
          setConflict(null);
        }
      } catch (err) {
        const lost = conflictOf(err);
        if (lost) setConflict(lost);
        else setSaveError(err);
      } finally {
        savingRef.current = false;
        setSaving(false);
      }
    },
    [id, settle],
  );

  const save = useCallback(() => {
    const d = draftRef.current;
    const b = baseRef.current;
    if (!d || !b) return;
    void put(d, recreateRef.current ? null : b);
  }, [put]);

  /** Save the draft over what won, having seen what that throws away. */
  const keepMine = useCallback(() => {
    const d = draftRef.current;
    if (!d || !conflict) return;
    if (conflict.current) setBase(conflict.current);
    else setRecreate(true);
    setConflict(null);
    void put(d, conflict.current);
  }, [conflict, put]);

  /** Drop the draft for what won. */
  const takeTheirs = useCallback(() => {
    if (conflict?.current) settle(conflict.current);
  }, [conflict, settle]);

  const discard = useCallback(() => {
    forget();
    generation.current += 1;
    setDraft(null);
    setBase(null);
    setRecreate(false);
    setConflict(null);
    setSaveError(null);
    setRefusal(null);
  }, [forget]);

  /** What the canvas and the inspector draw: the draft, with its last check, or the saved workflow. */
  const record = useMemo((): WorkflowRecord | undefined => {
    if (!draft || !base) return saved;
    return {
      ...base,
      definition: draft,
      ports: check?.result.ports ?? base.ports,
      problems: check?.result.problems ?? base.problems,
    };
  }, [draft, base, check, saved]);

  return {
    /** The saved workflow, newest known. */
    saved,
    record,
    dirty: draft !== null,
    /** The draft has been checked since its last edit. */
    checked: draft === null || check?.of === draft,
    checkError,
    edit,
    wire,
    save,
    saving,
    saveError,
    conflict,
    keepMine,
    takeTheirs,
    discard,
    refusal,
    clearRefusal: useCallback(() => setRefusal(null), []),
    undo,
    redo,
    canUndo: past.current.length > 0,
    canRedo: future.current.length > 0,
  };
}

export type WorkflowDraft = ReturnType<typeof useWorkflowDraft>;
