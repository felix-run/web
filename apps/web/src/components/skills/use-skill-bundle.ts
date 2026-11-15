import { isAllowedPath } from '@felix/skill-format';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isProtectedPath, pathsUnder } from './bundle-paths';

/**
 * The editor's working copy of a skill bundle, and whether it differs from the
 * version it was loaded from.
 *
 * Two rules carry the weight. The baseline re-initialises only on a *version*
 * change or while the copy is clean, so a background refetch can never clobber
 * an edit in progress. And every mutation reads the current files through a
 * ref, so a create or rename can answer "did that work" synchronously — the
 * file tree's inline input needs the answer before React has re-rendered.
 *
 * Every path it creates or renames to goes through the harness's allowlist
 * (`isAllowedPath`), so a working copy cannot hold a path a save would refuse.
 */

export type SkillBundleState = {
  files: Record<string, string>;
  activePath: string;
  dirty: boolean;
  pendingDirs: string[];
  setActivePath: (path: string) => void;
  setFileContent: (path: string, content: string) => void;
  createFile: (path: string) => boolean;
  createDir: (path: string) => void;
  renamePath: (from: string, to: string) => boolean;
  deletePath: (path: string) => void;
  overwriteSkillMd: (content: string) => void;
  reset: (files: Record<string, string>) => void;
};

function sameFiles(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => b[key] === a[key]);
}

export function useSkillBundle({
  initialFiles,
  versionId,
  draft,
}: {
  initialFiles: Record<string, string> | undefined;
  versionId: string | undefined;
  /**
   * A working copy kept from an earlier mount, over `versionId`'s files. Taken once, on the
   * first load: the side pane unmounts the editor on every tab switch, and the edit outlives it.
   */
  draft?: Record<string, string>;
}): SkillBundleState {
  const [files, setFilesState] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState<Record<string, string>>({});
  const [activePath, setActivePath] = useState('SKILL.md');
  const [pendingDirs, setPendingDirs] = useState<string[]>([]);
  const loadedVersionRef = useRef<string | undefined>(undefined);
  const draftRef = useRef(draft);
  /** The version a kept draft was put over, so a second run of the load cannot replace it. */
  const draftedRef = useRef<string | undefined>(undefined);

  // Mutations read current files through this ref so their callbacks can
  // return success synchronously without depending on `files` identity.
  const filesRef = useRef(files);
  filesRef.current = files;

  const setFiles = useCallback((next: Record<string, string>) => {
    filesRef.current = next;
    setFilesState(next);
  }, []);

  const dirty = useMemo(() => !sameFiles(files, baseline), [files, baseline]);

  // SKILL.md is required, so an empty or partial bundle still gets an editable stub.
  useEffect(() => {
    if (!initialFiles) return;
    const loaded: Record<string, string> = { 'SKILL.md': '', ...initialFiles };
    const versionChanged = versionId !== loadedVersionRef.current;
    if (!versionChanged && dirty) return;
    // StrictMode runs this twice on mount, the second time before the draft has reached state:
    // `dirty` still reads false then, and loading again would put the stored files over the
    // draft. `filesRef` already holds it.
    if (
      !versionChanged &&
      draftedRef.current === versionId &&
      !sameFiles(filesRef.current, loaded)
    ) {
      return;
    }
    if (!versionChanged && sameFiles(files, loaded)) return;
    const kept = loadedVersionRef.current === undefined ? draftRef.current : undefined;
    draftRef.current = undefined;
    if (kept) draftedRef.current = versionId;
    loadedVersionRef.current = versionId;
    const start = kept ?? loaded;
    setFiles(start);
    setBaseline(loaded);
    setPendingDirs([]);
    setActivePath((path) => (start[path] !== undefined ? path : 'SKILL.md'));
  }, [initialFiles, versionId, dirty, files, setFiles]);

  const setFileContent = useCallback(
    (path: string, content: string) => {
      const prev = filesRef.current;
      if (prev[path] === content) return;
      setFiles({ ...prev, [path]: content });
    },
    [setFiles],
  );

  const createFile = useCallback(
    (path: string) => {
      const prev = filesRef.current;
      if (!isAllowedPath(path) || prev[path] !== undefined) return false;
      setFiles({ ...prev, [path]: '' });
      setPendingDirs((dirs) => dirs.filter((dir) => !path.startsWith(`${dir}/`)));
      setActivePath(path);
      return true;
    },
    [setFiles],
  );

  const createDir = useCallback((path: string) => {
    setPendingDirs((prev) => (prev.includes(path) ? prev : [...prev, path]));
  }, []);

  const renamePath = useCallback(
    (from: string, to: string) => {
      if (isProtectedPath(from) || from === to) return false;
      const prev = filesRef.current;
      const moves: Array<[string, string]> =
        prev[from] !== undefined
          ? [[from, to]]
          : pathsUnder(prev, from).map((path) => [path, `${to}${path.slice(from.length)}`]);
      if (moves.length === 0) return false;
      if (moves.some(([, target]) => !isAllowedPath(target) || prev[target] !== undefined)) {
        return false;
      }
      const next = { ...prev };
      for (const [source, target] of moves) {
        next[target] = next[source] ?? '';
        delete next[source];
      }
      setFiles(next);
      setActivePath((path) =>
        path === from || path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : path,
      );
      return true;
    },
    [setFiles],
  );

  const deletePath = useCallback(
    (path: string) => {
      if (isProtectedPath(path)) return;
      const prev = filesRef.current;
      const removed = prev[path] !== undefined ? [path] : pathsUnder(prev, path);
      if (removed.length > 0) {
        const next = { ...prev };
        for (const key of removed) delete next[key];
        setFiles(next);
      }
      setPendingDirs((dirs) => dirs.filter((dir) => dir !== path && !dir.startsWith(`${path}/`)));
      setActivePath((active) =>
        active === path || active.startsWith(`${path}/`) ? 'SKILL.md' : active,
      );
    },
    [setFiles],
  );

  /** Replace SKILL.md wholesale — taking the newer version's text in a merge. */
  const overwriteSkillMd = useCallback(
    (content: string) => {
      setFiles({ ...filesRef.current, 'SKILL.md': content });
    },
    [setFiles],
  );

  /** Re-baseline after a save: the saved files become the clean state. */
  const reset = useCallback(
    (nextFiles: Record<string, string>) => {
      setFiles(nextFiles);
      setBaseline(nextFiles);
      setPendingDirs([]);
    },
    [setFiles],
  );

  return {
    files,
    activePath,
    dirty,
    pendingDirs,
    setActivePath,
    setFileContent,
    createFile,
    createDir,
    renamePath,
    deletePath,
    overwriteSkillMd,
    reset,
  };
}
