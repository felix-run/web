/**
 * The file tools a client runs against the user's own folder, and the one mapping that says
 * which tool names are file operations at all.
 *
 * Two families of names mean the same five operations. The harness's workspace tools
 * (`list_dir`, `read_file`, …) act on a folder on the server; the cowork manifest's client
 * tools (`local_list`, `local_read`, …) act on the user's folder — the browser's mount or
 * in-tab files, or the terminal client's working directory. Everything that cares what a call
 * did to a file (the changes list, the approval diff, the failure badge) asks `fileToolOp`
 * rather than matching names, so the second family is not a second set of special cases.
 *
 * The operations themselves live here, over `LocalFs`, so a browser and a terminal answer the
 * model identically: the same output shape, the same refusals, the same limits. A client
 * supplies only the filesystem — and with it the rules that are its own: containment, and
 * whether a write needs a person's yes.
 */
import type { ClientToolRequest, ClientToolResult } from './client-tools';

export type FileToolOp = 'list' | 'read' | 'search' | 'write' | 'edit';

const OPS: Readonly<Record<string, FileToolOp>> = {
  list_dir: 'list',
  read_file: 'read',
  search_files: 'search',
  write_file: 'write',
  edit_file: 'edit',
  local_list: 'list',
  local_read: 'read',
  local_search: 'search',
  local_write: 'write',
  local_edit: 'edit',
};

/** The prefix the engine gives a call the client ran (`client · local_shell`). */
const CLIENT_PREFIX = 'client · ';

/** The file operation a tool name performs, on either family, or null for any other tool. */
export function fileToolOp(toolName: string): FileToolOp | null {
  const name = toolName.startsWith(CLIENT_PREFIX) ? toolName.slice(CLIENT_PREFIX.length) : toolName;
  return OPS[name] ?? null;
}

/** True for a client tool this module answers. */
export function isLocalFileTool(name: string): boolean {
  return name.startsWith('local_') && name in OPS;
}

export interface LocalEntry {
  /** Relative to the folder's root, `/`-separated. */
  path: string;
  type: 'file' | 'dir';
}

/**
 * The folder, as the five operations need it. Paths are relative to its root and arrive as
 * the model wrote them; an implementation owns containment and refuses by throwing.
 */
export interface LocalFs {
  /** Direct entries of a directory (`''` or `.` is the root). */
  list(path: string): Promise<LocalEntry[]>;
  read(path: string): Promise<string>;
  /** Create or replace a file, creating parent directories. May throw a refusal. */
  write(path: string, content: string, opts: { append: boolean; summary: string }): Promise<void>;
}

/** Entries `local_list` prints before saying how many it left out. */
export const MAX_LIST_ENTRIES = 1_000;
/** Characters `local_read` returns when the call names no limit. */
export const DEFAULT_READ_CHARS = 100_000;
/** Files over this many characters are not searched. */
const MAX_SEARCH_FILE_CHARS = 1_000_000;
/** Files `local_search` opens before it stops looking. */
const MAX_SEARCH_FILES = 5_000;
/** A matching line is cut to this many characters. */
const MAX_HIT_CHARS = 300;
/** Folders a recursive listing or a search does not descend into. */
const SKIPPED = new Set(['.git', 'node_modules']);

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function int(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined;
}

/** `./a/b/` → `a/b`; the root is `''`. */
function clean(path: string | undefined): string {
  return (path ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter((p) => p && p !== '.')
    .join('/');
}

function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** Breadth-first, skipping `.git` and `node_modules`, until `limit` entries. */
async function walk(
  fs: LocalFs,
  root: string,
  limit: number,
): Promise<{ entries: LocalEntry[]; more: boolean }> {
  const entries: LocalEntry[] = [];
  const queue = [root];
  for (let dir = queue.shift(); dir !== undefined; dir = queue.shift()) {
    for (const entry of await fs.list(dir)) {
      if (SKIPPED.has(baseName(entry.path))) continue;
      if (entries.length >= limit) return { entries, more: true };
      entries.push(entry);
      if (entry.type === 'dir') queue.push(entry.path);
    }
  }
  return { entries, more: false };
}

async function list(fs: LocalFs, args: Record<string, unknown>): Promise<string> {
  const path = clean(str(args.path));
  const { entries, more } =
    args.recursive === true
      ? await walk(fs, path, MAX_LIST_ENTRIES)
      : await fs.list(path).then((all) => ({
          entries: all.slice(0, MAX_LIST_ENTRIES),
          more: all.length > MAX_LIST_ENTRIES,
        }));
  if (!entries.length) return `(${path || 'the folder'} is empty)`;
  const lines = entries.map((e) => (e.type === 'dir' ? `${e.path}/` : e.path));
  if (more)
    lines.push(`[… stopped at ${MAX_LIST_ENTRIES} entries; list a subdirectory to see more]`);
  return lines.join('\n');
}

async function read(fs: LocalFs, args: Record<string, unknown>): Promise<string> {
  const path = clean(str(args.path));
  if (!path) return 'error: path is required';
  const text = await fs.read(path);
  const offset = Math.max(0, int(args.offset) ?? 0);
  const limit = Math.max(1, int(args.limit) ?? DEFAULT_READ_CHARS);
  const slice = text.slice(offset, offset + limit);
  const end = offset + slice.length;
  if (offset === 0 && end >= text.length) return slice;
  return `${slice}\n[… characters ${offset}–${end} of ${text.length}; pass offset=${end} to read on]`;
}

/** A regular expression the model wrote, or a literal match; never throws. */
function matcher(query: string, regex: boolean): ((line: string) => boolean) | string {
  if (!regex) return (line) => line.includes(query);
  try {
    const re = new RegExp(query);
    return (line) => re.test(line);
  } catch (err) {
    return `error: invalid regular expression: ${err instanceof Error ? err.message : String(err)}`;
  }
}

async function search(fs: LocalFs, args: Record<string, unknown>): Promise<string> {
  const query = str(args.query) ?? '';
  if (!query) return 'error: query is required';
  const matches = matcher(query, args.regex === true);
  if (typeof matches === 'string') return matches;
  const maxHits = Math.min(200, Math.max(1, int(args.max_hits) ?? 20));
  const root = clean(str(args.path));
  const { entries } = await walk(fs, root, MAX_SEARCH_FILES);

  const hits: string[] = [];
  for (const entry of entries) {
    if (entry.type !== 'file') continue;
    let text: string;
    try {
      text = await fs.read(entry.path);
    } catch {
      continue;
    }
    // Binary, by the heuristic the file preview uses, or too large to be worth scanning.
    if (text.length > MAX_SEARCH_FILE_CHARS || text.slice(0, 8_000).includes('\0')) continue;
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (!matches(line.slice(0, 4_000))) continue;
      hits.push(`${entry.path}:${i + 1}:${line.trim().slice(0, MAX_HIT_CHARS)}`);
      if (hits.length >= maxHits) {
        return `${hits.join('\n')}\n[… stopped at ${maxHits} matches]`;
      }
    }
  }
  return hits.length ? hits.join('\n') : `(no matches for ${JSON.stringify(query)})`;
}

async function write(fs: LocalFs, args: Record<string, unknown>): Promise<string> {
  const path = clean(str(args.path));
  const content = str(args.content);
  if (!path) return 'error: path is required';
  if (content === undefined) return 'error: content is required';
  const append = args.append === true;
  await fs.write(path, content, {
    append,
    summary: `${append ? 'append' : 'write'} ${content.length} chars to`,
  });
  return `${append ? 'appended' : 'wrote'} ${content.length} chars to ${path}`;
}

function occurrences(text: string, needle: string): number {
  let count = 0;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) {
    count++;
  }
  return count;
}

async function edit(fs: LocalFs, args: Record<string, unknown>): Promise<string> {
  const path = clean(str(args.path));
  const oldString = str(args.old_string);
  const newString = str(args.new_string);
  if (!path) return 'error: path is required';
  if (!oldString) return 'error: old_string is required and must not be empty';
  if (newString === undefined) return 'error: new_string is required';
  const text = await fs.read(path);
  const found = occurrences(text, oldString);
  if (found === 0) return `error: old_string was not found in ${path}`;
  const all = args.replace_all === true;
  if (found > 1 && !all) {
    return `error: old_string appears ${found} times in ${path}; include more surrounding text, or pass replace_all`;
  }
  const next = all
    ? text.split(oldString).join(newString)
    : text.replace(oldString, () => newString);
  await fs.write(path, next, {
    append: false,
    summary: `edit (${found} replacement${found === 1 ? '' : 's'})`,
  });
  return JSON.stringify({ path, replacements: all ? found : 1 });
}

/**
 * Answer one of the `local_*` file tools against `fs`.
 *
 * Every failure is a result, spelled `error: …` — the spelling `classifyToolResult` reads as a
 * failed call for these tools — because the run is blocked on the answer and a throw would
 * only reach the settle wrapper's generic message.
 */
export async function runLocalFileTool(
  req: ClientToolRequest,
  fs: LocalFs,
): Promise<ClientToolResult> {
  const args = req.args ?? {};
  try {
    let content: string;
    switch (fileToolOp(req.name)) {
      case 'list':
        content = await list(fs, args);
        break;
      case 'read':
        content = await read(fs, args);
        break;
      case 'search':
        content = await search(fs, args);
        break;
      case 'write':
        content = await write(fs, args);
        break;
      case 'edit':
        content = await edit(fs, args);
        break;
      default:
        return { content: `error: unknown client tool ${req.name}`, error: true };
    }
    return content.startsWith('error: ') ? { content, error: true } : { content };
  } catch (err) {
    return { content: `error: ${err instanceof Error ? err.message : String(err)}`, error: true };
  }
}
