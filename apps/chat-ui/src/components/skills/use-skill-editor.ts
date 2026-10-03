import {
  isStaleWrite,
  requestBodyBytes,
  type SkillDetail,
  type SkillFile,
  type SkillWriteResult,
} from '@felix/client';
import {
  binaryAssetMimeType,
  isBinaryAssetPath,
  reviewSkillBundle,
  scanSkillSecurity,
  validateSkillBundle,
} from '@felix/skill-format';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { getLibrarySkill, saveSkillVersion } from '@/api';
import { compareBundles, type FileChange } from './bundle-compare';
import { errorLinesForSkillMd } from './frontmatter-lines';
import { invalidateLibrary, skillKeys, useSkillBundleFiles, useSkillVersion } from './queries';
import type { SaveChoice } from './save-dialog';
import { useSkillBundle } from './use-skill-bundle';

/** The text the harness writes in place of a secret it found in a file. */
export const REDACTED = '[REDACTED]';

/**
 * A save the harness refused because the library moved on: someone (or an
 * agent) saved a newer version after this editor loaded its parent. Held until
 * the operator chooses — the editor never decides on their behalf.
 */
export interface StaleSave {
  code: string;
  /** The newest version now, re-read after the refusal; null if that read failed too. */
  newest: string | null;
}

/** What a non-SKILL.md file does when edits are kept on top of a newer version. */
export type Resolution = 'theirs' | 'mine';

/**
 * "Keep my edits" in progress: the version the next save names as its parent,
 * the version the working copy was last reconciled against, and the working
 * copy as it stood when the choice was made — what "keep mine" restores.
 */
interface Rebase {
  onto: string;
  base: string;
  mine: Record<string, string>;
}

/**
 * Everything the Edit tab holds, lifted above the tabs so switching to
 * Versions to diff the working copy, and back, keeps the edits.
 *
 * Two versions are tracked, and keeping them apart is what makes the conflict
 * flow honest:
 *
 * - `loadedFrom` is whose files the working copy started from. Changing it
 *   re-baselines the copy — the "reload" choice.
 * - `parent` is what a save names as `parent_version`, which the harness
 *   requires to be the newest. Moving only `parent` is "keep my edits on top of
 *   the newer version": the copy is untouched, and the page shows what the
 *   newer version changed before the operator saves over it.
 *
 * A save sends the *whole* bundle, so keeping edits on top of a newer version
 * would silently undo every other file that version changed. Each one is
 * listed (`rebase.upstream`) and the save is held until the operator has taken
 * the newer file or kept their own, file by file. SKILL.md is the one file
 * shown as a diff against the working copy instead, since it is the file being
 * edited.
 *
 * Nothing is ever saved over a newer version without those choices being made.
 */
export function useSkillEditor(name: string, detail: SkillDetail | undefined, enabled = true) {
  const client = useQueryClient();
  const newest = detail?.versions[0]?.version ?? null;
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [stale, setStale] = useState<StaleSave | null>(null);
  /** Set by "keep my edits": the version saved over, whose changes the page shows. */
  const [rebase, setRebase] = useState<Rebase | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [lastSave, setLastSave] = useState<SkillWriteResult | null>(null);

  // The first answer about the skill decides where editing starts: its newest.
  // Not before the Edit tab is first opened: loading a bundle is a request per
  // file, and a page visited to read the versions list should not pay for it.
  useEffect(() => {
    if (enabled && newest && loadedFrom === null) {
      setLoadedFrom(newest);
      setParent(newest);
    }
  }, [enabled, newest, loadedFrom]);

  const files = useSkillBundleFiles(name, loadedFrom);
  const bundle = useSkillBundle({
    initialFiles: files.data?.files,
    versionId: loadedFrom ?? undefined,
  });

  // From the working copy, not the load: a newer file taken during a rebase is
  // read redacted too, and saving it would write the placeholder.
  const redacted = useMemo(
    () =>
      Object.entries(bundle.files)
        .filter(([path, content]) => !isBinaryAssetPath(path) && content.includes(REDACTED))
        .map(([path]) => path),
    [bundle.files],
  );

  const baseDetail = useSkillVersion(name, rebase?.base);
  const ontoDetail = useSkillVersion(name, rebase?.onto);
  const baseFiles = useSkillBundleFiles(name, rebase?.base);
  const ontoFiles = useSkillBundleFiles(name, rebase?.onto);
  const upstream = useMemo<FileChange[] | null>(() => {
    if (!baseDetail.data || !ontoDetail.data) return null;
    return compareBundles(baseDetail.data.files, ontoDetail.data.files).filter(
      (c) => c.path !== 'SKILL.md',
    );
  }, [baseDetail.data, ontoDetail.data]);
  const unresolved = rebase
    ? upstream === null
      ? null
      : upstream.filter((c) => !resolutions[c.path])
    : [];

  const deferred = useDeferredValue(bundle.files);
  const loaded = Object.keys(deferred).length > 0;
  const issues = useMemo(() => {
    if (!loaded) return [];
    const result = validateSkillBundle(deferred, name);
    return result.valid ? [] : result.errors;
  }, [deferred, loaded, name]);
  const errorLines = useMemo(
    () => errorLinesForSkillMd(deferred['SKILL.md'] ?? '', issues),
    [deferred, issues],
  );
  const local = useMemo(
    () =>
      loaded
        ? { review: reviewSkillBundle(deferred, name), scan: scanSkillSecurity(deferred) }
        : null,
    [deferred, loaded, name],
  );
  const bodyBytes = useMemo(() => requestBodyBytes({ files: deferred }), [deferred]);

  const save = useMutation({
    mutationFn: (choice: SaveChoice & { files: Record<string, string>; parent: string }) => {
      return saveSkillVersion(name, {
        files: choice.files,
        parent_version: choice.parent,
        bump: choice.bump,
        reason: choice.reason,
        publish: choice.publish,
      });
    },
    onSuccess: (result, choice) => {
      // The saved files *are* the new version's bundle, so they seed its cache
      // rather than being read back: the read is secret-redacted, and a working
      // copy rebuilt from it would carry `[REDACTED]` into the next save.
      const meta: SkillFile[] = result.files.map((f) => {
        const binary = isBinaryAssetPath(f.path);
        return {
          ...f,
          content: choice.files[f.path] ?? '',
          encoding: binary ? 'base64' : 'utf-8',
          content_type: binary ? binaryAssetMimeType(f.path) : 'text/plain; charset=utf-8',
        };
      });
      client.setQueryData(skillKeys.bundle(name, result.version), {
        files: choice.files,
        meta,
      });
      setLoadedFrom(result.version);
      setParent(result.version);
      setRebase(null);
      setResolutions({});
      setStale(null);
      setLastSave(result);
      void invalidateLibrary(client);
    },
    onError: async (err, choice) => {
      if (!isStaleWrite(err)) return;
      // Re-read the skill to name the version that won, rather than guessing —
      // and never from the cache, which can still say the refused parent is the
      // newest. A read that fails, or that still says so, names nothing.
      let now: string | null = null;
      try {
        const fresh = await client.fetchQuery({
          queryKey: skillKeys.skill(name),
          queryFn: () => getLibrarySkill(name),
          staleTime: 0,
        });
        now = fresh.versions[0]?.version ?? null;
      } catch {
        now = null;
      }
      setStale({ code: err.code, newest: now === choice.parent ? null : now });
    },
  });

  return {
    newest,
    loadedFrom,
    parent,
    files,
    bundle,
    redacted,
    issues,
    errorLines,
    local,
    bodyBytes,
    save,
    stale,
    lastSave,
    /** The rebase in progress, with what the newer version changed outside SKILL.md. */
    rebase: rebase
      ? {
          onto: rebase.onto,
          base: rebase.base,
          upstream,
          /** Changed upstream and not yet decided; null while the comparison loads. */
          unresolved,
          resolutions,
          baseFiles: baseFiles.data?.files,
          ontoFiles: ontoFiles.data?.files,
          error: baseDetail.error ?? ontoDetail.error ?? ontoFiles.error ?? null,
        }
      : null,
    /** Take the newer version's file, or keep this copy's, for one upstream change. */
    resolve: (change: FileChange, choice: Resolution) => {
      if (!rebase) return;
      if (choice === 'theirs') {
        const theirs = ontoFiles.data?.files;
        if (!theirs) return;
        if (change.kind === 'removed') bundle.deletePath(change.path);
        else bundle.setFileContent(change.path, theirs[change.path] ?? '');
      } else {
        const mine = rebase.mine[change.path];
        if (mine === undefined) bundle.deletePath(change.path);
        else bundle.setFileContent(change.path, mine);
      }
      setResolutions((r) => ({ ...r, [change.path]: choice }));
    },
    /** Whether a save may go now; the reason when it may not. */
    saveBlocked:
      unresolved === null
        ? 'Comparing your edits with the newer version…'
        : unresolved.length > 0
          ? `Choose what happens to ${unresolved.length} file${unresolved.length === 1 ? '' : 's'} the newer version changed first.`
          : null,
    clearLastSave: () => setLastSave(null),
    /** Discard the working copy and load `version` — the newest, after a conflict. */
    reloadFrom: (version: string) => {
      setStale(null);
      setRebase(null);
      setResolutions({});
      save.reset();
      setLoadedFrom(version);
      setParent(version);
    },
    /** Keep the working copy and make `version` the parent the next save names. */
    keepEditsOnto: (version: string) => {
      setStale(null);
      save.reset();
      // Reconcile against what the copy last agreed with: the version it was
      // loaded from, or the one an earlier "keep" already settled against.
      setRebase({ onto: version, base: rebase?.onto ?? loadedFrom ?? version, mine: bundle.files });
      setResolutions({});
      setParent(version);
    },
  };
}

export type SkillEditor = ReturnType<typeof useSkillEditor>;
