/**
 * Putting files back on a rewind (`POST /chat/rewind` with `restore_files`, `felix-run/felix#621`).
 *
 * **The question can only be asked before the rewind.** Every rewind settles the branch it leaves:
 * with `restore_files` its changes are put back, without it they stay, and either way the records
 * are then forgotten. So a client decides whether to ask from the turns it is about to abandon.
 */

import { classifyToolResult } from './tool-results';
import type { Turn } from './turns';

/** What the harness records. `local_*` tools write the person's own folder, which it never sees. */
const RECORDED_TOOLS = new Set([
  'write_file',
  'edit_file',
  'multi_edit',
  'delete_file',
  'rename_file',
]);

/** The `files` of a rewind's answer. `error` is a restore that could not run at all. */
export interface RestoredFiles {
  restored?: string[];
  removed?: string[];
  conflicts?: string[];
  skipped?: string[];
  truncated?: boolean;
  error?: string;
}

/** How many files the agent changed in these turns, by tools the harness records. */
export function recordedFileChanges(turns: readonly Turn[]): number {
  const paths = new Set<string>();
  let unnamed = 0;
  for (const turn of turns) {
    for (const tool of turn.tools ?? []) {
      if (!RECORDED_TOOLS.has(tool.name) || !tool.done) continue;
      if (classifyToolResult(tool.name, tool.output)) continue;
      const path = (tool.input as { path?: unknown } | undefined)?.path;
      if (typeof path === 'string' && path) paths.add(path);
      else unnamed += 1;
    }
  }
  return paths.size + unnamed;
}

const count = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

function listed(paths: string[]): string {
  const shown = paths.slice(0, 5).join(', ');
  return paths.length > 5 ? `${shown} and ${paths.length - 5} more` : shown;
}

/**
 * The restore in words: what was done, and apart from it what was not, which is the part a person
 * has to act on. `problem` is null when every change was undone.
 */
export function describeRestoredFiles(files: RestoredFiles | undefined): {
  done: string;
  problem: string | null;
} {
  if (files?.error) {
    return {
      done: 'No files were put back.',
      problem: 'The harness could not restore them, but kept its records: a later rewind can.',
    };
  }
  const restored = files?.restored ?? [];
  const removed = files?.removed ?? [];
  const parts = [
    ...(restored.length ? [`Put back ${count(restored.length, 'file')}`] : []),
    ...(removed.length ? [`removed ${count(removed.length, 'new file')}`] : []),
  ];
  const problems = [
    ...(files?.conflicts?.length
      ? [`Left alone because they changed since: ${listed(files.conflicts)}.`]
      : []),
    ...(files?.skipped?.length
      ? [`Their earlier versions were not kept: ${listed(files.skipped)}.`]
      : []),
    ...(files?.truncated ? ['The branch changed too much to undo all of it.'] : []),
  ];
  return {
    done: parts.length ? `${parts.join(', ')}.` : 'No files were put back.',
    problem: problems.length ? problems.join(' ') : null,
  };
}
