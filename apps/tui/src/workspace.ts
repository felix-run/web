/**
 * Client-executed tools, against the real filesystem.
 *
 * A `tool_request` frame means the harness has handed a tool back for *this*
 * process to run. chat-ui answers those from an in-tab virtual filesystem
 * because a browser has nothing else; a terminal has the actual working
 * directory, which is the whole reason to run Felix here.
 *
 * Three rules, and none is negotiable:
 *
 * - **Everything resolves under one root.** The model chooses these paths, and a
 *   tool result it wrote earlier can carry a path it invented. `resolveWithin`
 *   is the only way a path becomes an absolute one, and it refuses anything that
 *   climbs out — including through a symlink, and including a *broken* symlink,
 *   which has no real path to check and which a write would otherwise follow.
 * - **Every write is confirmed.** `confirm` is required rather than optional, so
 *   a caller cannot get a silent writer by forgetting to pass one; `--yes` is
 *   spelled as a confirm that always agrees.
 * - **Every request settles.** The run is blocked on the answer; a refusal is a
 *   result, a hang is not.
 *
 * What is deliberately *not* here is a rule about reads. Reads are not
 * confirmed, which is the real trade of pointing an agent at a working
 * directory: a model that has been fed a hostile tool result can read anything
 * under the root — `.env` included — and the result goes to the harness. Scope
 * that by choosing the directory you start in.
 *
 * No process execution. `local_shell` here is the same handful of verbs the
 * browser client implements, run against real files — not a shell. Spawning
 * what the model typed is a different feature with a different threat model.
 */
import { constants } from 'node:fs';
import {
  access,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { type ClientToolRequest, type ClientToolResult, settleClientTool } from '@felix/client';

/**
 * Asked before anything is written, with the **absolute** path it would touch.
 *
 * Absolute because the relative spelling is the model's, and a summary that
 * echoes it back cannot be checked: `write 5 chars to notes` reads the same
 * whether it lands in the project or three directories above it.
 */
export type ConfirmFn = (summary: string) => Promise<boolean>;

export interface WorkspaceOptions {
  root: string;
  confirm: ConfirmFn;
  /** Abandons an in-flight tool when the run is stopped. */
  signal?: AbortSignal;
}

/** How many entries `ls` and `tree` will print before truncating. */
const MAX_ENTRIES = 200;
/** Beyond this a file is reported by size rather than pasted into the transcript. */
const MAX_READ_BYTES = 200_000;

/**
 * Trees a write is refused into outright.
 *
 * Not containment — these are all *inside* the root. They are the paths where
 * "write a file" becomes "run a command": a git hook, a husky hook, `core.pager`
 * in `.git/config`, a shim on `PATH`. The user gets one line of confirmation
 * text to judge a write by, which is not enough to catch that, so the answer is
 * to not offer it.
 */
const NEVER_WRITE = ['.git', '.husky', 'node_modules'];

export class PathEscape extends Error {
  constructor(path: string) {
    super(`refused: ${path} is outside the workspace root`);
    this.name = 'PathEscape';
  }
}

export class WriteRefused extends Error {
  constructor(path: string, why: string) {
    super(`refused: ${path} ${why}`);
    this.name = 'WriteRefused';
  }
}

/**
 * Resolve `path` against the root, or refuse.
 *
 * Three checks, because each catches what the others cannot. The lexical one
 * catches `../..`. Resolving the deepest *existing* ancestor catches a symlinked
 * directory — that is where a write actually lands. And the leaf is examined on
 * its own with `lstat`, because a symlink whose target does not exist has no
 * real path at all: the ancestor walk sails past it, and `writeFile` then
 * follows it out of the tree. That was a working escape, not a hypothetical.
 */
export async function resolveWithin(root: string, path: string): Promise<string> {
  const realRoot = await realpath(root);
  const absolute = isAbsolute(path) ? resolve(path) : resolve(realRoot, path);

  const within = (candidate: string) => {
    const rel = relative(realRoot, candidate);
    // Split rather than `startsWith('..')`, which also rejects a file honestly
    // named `..config`.
    return rel === '' || (rel.split(sep)[0] !== '..' && !isAbsolute(rel));
  };
  if (!within(absolute)) throw new PathEscape(path);

  const leaf = await lstat(absolute).catch(() => null);
  if (leaf?.isSymbolicLink()) {
    // A link that resolves is judged by where it points; one that does not
    // resolve is refused, because nothing can say where a write through it goes.
    const target = await realpath(absolute).catch(() => null);
    if (!target || !within(target)) throw new PathEscape(path);
    return target;
  }

  // Walk up to the deepest ancestor that exists, resolve *that*, and rebuild.
  // The rebuilt path is what gets written, so a symlinked parent is followed
  // here — where it can still be checked — rather than by the filesystem later.
  let existing = absolute;
  while (true) {
    const real = await realpath(existing).catch(() => null);
    if (real) {
      const tail = relative(existing, absolute);
      const resolved = tail ? join(real, tail) : real;
      if (!within(real) || !within(resolved)) throw new PathEscape(path);
      return resolved;
    }
    const parent = dirname(existing);
    if (parent === existing) throw new PathEscape(path);
    existing = parent;
  }
}

/** Refuse the in-root paths where writing a file means running a command. */
async function assertWritable(realRoot: string, target: string): Promise<void> {
  const segments = relative(realRoot, target).split(sep);
  const guarded = NEVER_WRITE.find((dir) => segments.includes(dir));
  if (guarded) throw new WriteRefused(target, `is inside ${guarded}/`);

  const info = await stat(target).catch(() => null);
  // An executable file that already exists is something that gets run. Replacing
  // its contents keeps the mode, so this is code execution wearing a write.
  if (info?.isFile() && (info.mode & 0o111) !== 0) {
    throw new WriteRefused(target, 'is executable');
  }
}

async function listDir(realRoot: string, target: string): Promise<string> {
  const entries = await readdir(target, { withFileTypes: true });
  const rows = entries
    .slice(0, MAX_ENTRIES)
    .map(
      (e) =>
        `${e.isDirectory() ? 'd' : '-'} ${join(relative(realRoot, target) || '.', e.name).replace(/^\.\//, '')}`,
    )
    .sort();
  if (!rows.length) return '(empty)';
  const more = entries.length - rows.length;
  return more > 0 ? `${rows.join('\n')}\n… ${more} more` : rows.join('\n');
}

/**
 * The file's text, or `null` when there is no text to give.
 *
 * Null rather than a message, because the caller that feeds an approval diff
 * cannot tell the two apart: returning `"(… too large to read in full)"` had the
 * banner report a 250 kB overwrite as replacing 53 characters.
 */
async function readFileText(target: string): Promise<string | null> {
  const info = await stat(target).catch(() => null);
  if (!info?.isFile() || info.size > MAX_READ_BYTES) return null;
  return await readFile(target, 'utf8');
}

async function readForShell(realRoot: string, target: string): Promise<string> {
  const info = await stat(target);
  const name = relative(realRoot, target) || '.';
  if (info.isDirectory()) return `error: ${name} is a directory`;
  if (info.size > MAX_READ_BYTES) {
    return `(${name} is ${info.size} bytes — too large to read in full)`;
  }
  return await readFile(target, 'utf8');
}

async function walk(realRoot: string, dir: string, out: string[]): Promise<void> {
  if (out.length >= MAX_ENTRIES) return;
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (out.length >= MAX_ENTRIES) return;
    // Skip the trees nobody means when they say "the project", and the ones
    // large enough to blow the entry budget before anything useful appears.
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = join(dir, entry.name);
    out.push(`${entry.isDirectory() ? 'd' : 'f'} ${relative(realRoot, full)}`);
    if (entry.isDirectory()) await walk(realRoot, full, out);
  }
}

async function runShell(command: string, opts: WorkspaceOptions): Promise<string> {
  const trimmed = command.trim();
  if (!trimmed) return '';
  const realRoot = await realpath(opts.root);
  const [bin, ...rest] = trimmed.split(/\s+/);
  const unquote = (s: string) => s.replace(/^['"]|['"]$/g, '');
  const arg = unquote(rest.join(' '));
  const at = (p: string) => resolveWithin(realRoot, p || '.');

  /** Every write goes through here: refuse the dangerous, then ask. */
  const guard = async (target: string, what: string) => {
    await assertWritable(realRoot, target);
    return await opts.confirm(`${what} ${target}`);
  };

  switch (bin) {
    case 'pwd':
      return realRoot;
    case 'ls':
      return await listDir(realRoot, await at(arg || '.'));
    case 'cat': {
      if (!arg) return 'usage: cat <path>';
      return await readForShell(realRoot, await at(arg));
    }
    case 'echo': {
      // Both spellings: `echo hi > out.txt` and `echo hi >out.txt`. Missing the
      // second returned the text as if it had been written, which the model
      // reads as success.
      const joined = rest.join(' ');
      const redirect = /^(.*?)>\s*(\S.*)$/.exec(joined);
      if (!redirect) return joined;
      const text = redirect[1]?.trim() ?? '';
      const path = unquote((redirect[2] ?? '').trim());
      if (!path) return 'usage: echo text > path';
      const target = await at(path);
      if (!(await guard(target, `write ${text.length} chars to`))) return 'refused by the user';
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `${text}\n`, 'utf8');
      return '';
    }
    case 'mkdir': {
      if (!arg) return 'usage: mkdir <path>';
      const target = await at(arg);
      if (!(await guard(target, 'create directory'))) return 'refused by the user';
      await mkdir(target, { recursive: true });
      return '';
    }
    case 'touch': {
      if (!arg) return 'usage: touch <path>';
      const target = await at(arg);
      try {
        await access(target, constants.F_OK);
        return '';
      } catch {
        if (!(await guard(target, 'create'))) return 'refused by the user';
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, '', 'utf8');
        return '';
      }
    }
    case 'tree': {
      const out: string[] = [];
      await walk(realRoot, realRoot, out);
      return out.join('\n') || '(empty)';
    }
    case 'help':
      return 'commands: pwd ls cat echo mkdir touch tree help';
    default:
      return `unsupported in the terminal client: ${bin}\n(try: pwd ls cat echo mkdir touch tree help)`;
  }
}

async function run(req: ClientToolRequest, opts: WorkspaceOptions): Promise<ClientToolResult> {
  try {
    if (req.name === 'local_shell') {
      const command = typeof req.args.command === 'string' ? req.args.command : '';
      const content = await runShell(command, opts);
      return { content: content || '(ok)' };
    }
    // The browser opens a tab. There is no equivalent here that is not a
    // surprise, and answering with a refusal keeps the run moving.
    if (req.name === 'local_open') {
      return { content: 'error: local_open is not supported by the terminal client', error: true };
    }
    return { content: `error: unknown client tool ${req.name}`, error: true };
  } catch (err) {
    return { content: `error: ${err instanceof Error ? err.message : String(err)}`, error: true };
  }
}

/** The `EnginePorts.clientTools` implementation this app hands the engine. */
export function createWorkspace(opts: WorkspaceOptions) {
  return {
    execute: (req: ClientToolRequest) =>
      settleClientTool(req, () => run(req, opts), opts.signal ? { signal: opts.signal } : {}),
    /**
     * Pre-edit text for a `write_file` approval diff. Null means new, unreadable,
     * a directory, or too large — anything the banner must not present as
     * "the current contents".
     */
    readForDiff: async (path: string): Promise<string | null> => {
      try {
        return await readFileText(await resolveWithin(opts.root, path));
      } catch {
        return null;
      }
    },
  };
}
