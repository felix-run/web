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
import { saveSkillVersion } from '@/api';
import { errorLinesForSkillMd } from './frontmatter-lines';
import { invalidateLibrary, skillKeys, useSkillBundleFiles } from './queries';
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
 * Nothing is ever saved over a newer version without that choice being made.
 */
export function useSkillEditor(name: string, detail: SkillDetail | undefined, enabled = true) {
  const client = useQueryClient();
  const newest = detail?.versions[0]?.version ?? null;
  const [loadedFrom, setLoadedFrom] = useState<string | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [stale, setStale] = useState<StaleSave | null>(null);
  /** Set by "keep my edits": the version saved over, whose changes the page shows. */
  const [rebasedOnto, setRebasedOnto] = useState<string | null>(null);
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

  const redacted = useMemo(
    () =>
      Object.entries(files.data?.files ?? {})
        .filter(([path, content]) => !isBinaryAssetPath(path) && content.includes(REDACTED))
        .map(([path]) => path),
    [files.data],
  );

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
    mutationFn: (choice: SaveChoice & { files: Record<string, string> }) => {
      if (!parent) throw new Error('No version to edit from yet');
      return saveSkillVersion(name, {
        files: choice.files,
        parent_version: parent,
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
      setRebasedOnto(null);
      setStale(null);
      setLastSave(result);
      void invalidateLibrary(client);
    },
    onError: async (err) => {
      if (!isStaleWrite(err)) return;
      // Re-read the skill to name the version that won, rather than guessing.
      let now: string | null = null;
      try {
        await client.invalidateQueries({ queryKey: skillKeys.skill(name) });
        const fresh = client.getQueryData<SkillDetail>(skillKeys.skill(name));
        now = fresh?.versions[0]?.version ?? null;
      } catch {
        now = null;
      }
      setStale({ code: err.code, newest: now });
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
    rebasedOnto,
    lastSave,
    clearLastSave: () => setLastSave(null),
    /** Discard the working copy and load `version` — the newest, after a conflict. */
    reloadFrom: (version: string) => {
      setStale(null);
      setRebasedOnto(null);
      save.reset();
      setLoadedFrom(version);
      setParent(version);
    },
    /** Keep the working copy and make `version` the parent the next save names. */
    keepEditsOnto: (version: string) => {
      setStale(null);
      save.reset();
      setParent(version);
      setRebasedOnto(version);
    },
  };
}

export type SkillEditor = ReturnType<typeof useSkillEditor>;
