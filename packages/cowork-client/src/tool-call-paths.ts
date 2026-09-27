/**
 * The paths a tool call already named.
 *
 * Prose says `foo.md`. The tool call that created it said `/home/lars/foo.md`.
 * Without that, a bare name can only be resolved against the indexed workspace —
 * so a file the agent wrote somewhere else, or wrote just now, either resolves
 * to the wrong `foo.md` or to nothing at all.
 *
 * These are hints, not answers: the resolver still has to match one against the
 * mention. What they add is the full path, which the message itself never
 * carries.
 *
 * ## Why only paths with a directory
 *
 * A bare name from a tool call tells the resolver nothing the basename index
 * does not already know. A path with a `/` is the entire point — it is what
 * disambiguates `foo.md` from the other three.
 *
 * ## Not "what the agent touched"
 *
 * A mention is not a touch. This walks every string a call carries, a pull
 * request's body included, so answering "which files did this call touch" from it
 * lists files the agent only wrote the name of. That question is
 * `collectTouchedPaths`, below.
 */

import { findFileMentions } from './file-mentions';

/** Ceilings, so a large tool payload cannot stall a render. */
const MAX_STRINGS = 24;
const MAX_STRING_LENGTH = 4_000;
const MAX_DEPTH = 2;

/**
 * Every path-shaped string in a tool call's arguments.
 *
 * The same prose heuristic runs over each string, so the exclusions that keep
 * version numbers and hostnames out of the transcript keep them out of here too
 * — arguments carry plenty of both.
 */
export function collectToolCallPaths(args: unknown): string[] {
  const strings: string[] = [];

  const walk = (value: unknown, depth: number): void => {
    if (strings.length >= MAX_STRINGS) return;
    if (typeof value === 'string') {
      strings.push(value.slice(0, MAX_STRING_LENGTH));
      return;
    }
    if (value === null || typeof value !== 'object') return;
    // An array does not count as a level: `{ edits: [{ path }] }` is an
    // ordinary shape, and charging it a level would put the path out of reach.
    if (Array.isArray(value)) {
      for (const child of value) walk(child, depth);
      return;
    }
    if (depth >= MAX_DEPTH) return;
    for (const child of Object.values(value)) walk(child, depth + 1);
  };
  walk(args, 0);

  const paths = new Set<string>();
  for (const text of strings) {
    for (const mention of findFileMentions(text)) {
      if (mention.path.includes('/')) paths.add(mention.path);
    }
  }
  return [...paths];
}

/**
 * The argument that names a file or directory, for each tool that touches the
 * workspace — and for no other tool.
 *
 * `collectToolCallPaths` answers "what might this call be *about*", which is the
 * right question for resolving a prose mention and the wrong one for "what did
 * the agent touch". Walking every string took the paths out of a pull request's
 * `body` and listed `./scripts/test.sh` as touched when the agent had only
 * written its name in a description. A tool touches what its path argument
 * names; every other string it carries is text.
 *
 * The names are the harness's workspace tools (`felix/tools/workspace.py`, all of
 * which take `path`) and the two client tools the cowork manifest declares.
 * `local_shell` contributes its `cwd` and never its `command`: which files a
 * command touched is not something its text can tell us, and guessing is how
 * this list came to report files nobody opened.
 *
 * Deliberately an allowlist, not "any tool with a `path`": a remote tool can take
 * one too — a GitHub file write's `path` is a file in someone else's repository,
 * not in this workspace.
 */
const PATH_ARGUMENTS: Readonly<Record<string, readonly string[]>> = {
  list_dir: ['path'],
  read_file: ['path'],
  write_file: ['path'],
  edit_file: ['path'],
  search_files: ['path'],
  local_shell: ['cwd'],
  local_open: ['target'],
};

/** The prefix the engine gives a call the browser ran (`client · local_shell`). */
const CLIENT_PREFIX = 'client · ';

/**
 * The workspace paths one tool call touched, by construction rather than by
 * heuristic: the path argument of a workspace tool, verbatim.
 *
 * A bare name counts — `notes.txt` at the root of the workspace is exactly the
 * write this exists to report. The workspace root itself (`.`, which `list_dir`
 * and `search_files` default to) is not a file anyone needs listed, and a URL
 * handed to `local_open` is not in the workspace at all.
 */
export function collectTouchedPaths(toolName: string, args: unknown): string[] {
  const name = toolName.startsWith(CLIENT_PREFIX) ? toolName.slice(CLIENT_PREFIX.length) : toolName;
  const keys = PATH_ARGUMENTS[name];
  if (!keys || args === null || typeof args !== 'object' || Array.isArray(args)) return [];
  const record = args as Record<string, unknown>;
  const paths: string[] = [];
  for (const key of keys) {
    const value = record[key];
    if (typeof value !== 'string') continue;
    const path = value.trim();
    if (!path || path === '.' || path === './') continue;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) continue;
    paths.push(path);
  }
  return paths;
}
