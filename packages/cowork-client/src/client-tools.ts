import {
  type ClientToolOptions,
  type ClientToolRequest,
  type ClientToolResult,
  DEFAULT_CLIENT_TOOL_TIMEOUT_MS,
  isLocalFileTool,
  type LocalFs,
  runLocalFileTool,
  settleClientTool,
} from '@felix/client';
import {
  clearMount,
  getMountIdentity,
  getMountLabel,
  hasMount,
  mountList,
  mountMkdir,
  mountRead,
  mountRemove,
  mountRename,
  mountTree,
  mountWrite,
  pickDirectory,
  readExisting,
  supportsDirectoryPicker,
} from './fs-mount';
import type { VirtualFs } from './vfs';

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function joinPath(cwd: string, p: string): string {
  if (!cwd || p.startsWith('/')) return p.replace(/^\//, '');
  return `${cwd.replace(/\/$/, '')}/${p}`.replace(/^\.\//, '');
}

async function runLocalShell(
  command: string,
  cwd: string,
  vfs: VirtualFs,
  check: () => void,
): Promise<string> {
  check();
  const trimmed = command.trim();
  if (!trimmed) return '';

  const [bin, ...rest] = trimmed.split(/\s+/);
  const arg = rest.join(' ').replace(/^['"]|['"]$/g, '');
  const join = (p: string) => joinPath(cwd, p);
  const mounted = hasMount();

  switch (bin) {
    case 'pwd':
      return cwd || (mounted ? `/${getMountLabel()}` : '/');
    case 'ls': {
      const target = join(arg || '.');
      const entries = mounted
        ? await mountList(target === '' ? '.' : target)
        : vfs.list(target === '' ? '.' : target);
      return (
        entries.map((e) => `${e.type === 'dir' ? 'd' : '-'} ${e.path}`).join('\n') || '(empty)'
      );
    }
    case 'cat': {
      if (!arg) return 'usage: cat <path>';
      return mounted ? await mountRead(join(arg)) : vfs.read(join(arg));
    }
    case 'echo': {
      const redirect = /^(.*?)>\s*(\S.*)$/.exec(rest.join(' '));
      if (redirect) {
        const text = redirect[1]?.trim() ?? '';
        const path = (redirect[2] ?? '').trim().replace(/^['"]|['"]$/g, '');
        if (!path) return 'usage: echo text > path';
        if (mounted) await mountWrite(join(path), `${text}\n`, false, check);
        else vfs.write(join(path), `${text}\n`);
        return '';
      }
      return rest.join(' ');
    }
    case 'mkdir': {
      if (!arg) return 'usage: mkdir <path>';
      if (mounted) await mountMkdir(join(arg), check);
      else vfs.mkdir(join(arg));
      return '';
    }
    case 'touch': {
      if (!arg) return 'usage: touch <path>';
      const path = join(arg);
      try {
        if (mounted) await mountRead(path);
        else vfs.read(path);
      } catch {
        check();
        if (mounted) await mountWrite(path, '', false, check);
        else vfs.write(path, '');
      }
      return '';
    }
    case 'tree':
      return (mounted ? await mountTree() : vfs.tree()).join('\n') || '(empty)';
    case 'help':
      return 'commands: pwd ls cat echo mkdir touch tree help';
    default:
      return `unsupported in browser shell: ${bin}\n(try: pwd ls cat echo mkdir touch tree help)`;
  }
}

/**
 * The folder the `local_*` file tools work on: the mounted one when there is one, else this
 * tab's own files — the same precedence every other client tool uses, decided per call so a
 * mount picked mid-run is what the next call sees.
 *
 * No confirmation here, unlike the terminal client: the cowork manifest gates `local_write`,
 * `local_edit`, `local_delete` and `local_rename` with an approval, so a write reaches this point only after a person said
 * yes on the banner, which is where the diff is drawn.
 */
export function workspaceFs(vfs: VirtualFs, check: () => void = () => {}): LocalFs {
  const checked = async <T>(work: () => T | Promise<T>): Promise<T> => {
    check();
    const result = await work();
    check();
    return result;
  };
  return {
    list: async (path) =>
      checked(() => (hasMount() ? mountList(path || '.') : vfs.list(path || '.'))),
    read: async (path) => checked(() => (hasMount() ? mountRead(path) : vfs.read(path))),
    write: async (path, content, { append }) => {
      check();
      if (hasMount()) await mountWrite(path, content, append, check);
      else vfs.write(path, content, append);
    },
    // Files only, never overwriting — the same rules the operator's pane
    // follows, through the same helpers, gated by the same approval rule.
    remove: async (path) => {
      check();
      if (hasMount()) await mountRemove(path, check);
      else vfs.remove(path);
    },
    rename: async (path, toPath) => {
      check();
      if (hasMount()) await mountRename(path, toPath, check);
      else vfs.rename(path, toPath);
    },
  };
}

export interface BrowserToolOptions extends ClientToolOptions {
  /**
   * Where `local_open` puts a workspace file — chat-ui's side pane. Given the
   * cleaned path of a file that exists. There is no new-tab fallback: a file
   * opened as a plain-text blob in another window was never what was asked
   * for, so without this a file target is refused and the run moves on.
   */
  openFile?: (path: string) => void;
}

/**
 * Run a tool the harness delegated to the browser, and *always settle*.
 *
 * The settle discipline itself is `@felix/client`'s — it is a property of the
 * protocol, not of the browser, and a terminal client needs exactly the same
 * guarantee. What is browser-specific is only what `runClientTool` does.
 */
export async function executeClientTool(
  req: ClientToolRequest,
  vfs: VirtualFs,
  opts: BrowserToolOptions = {},
): Promise<ClientToolResult> {
  const controller = new AbortController();
  const signal = opts.signal
    ? AbortSignal.any([opts.signal, controller.signal])
    : controller.signal;
  const mount = getMountIdentity();
  const check = () => {
    signal.throwIfAborted();
    if (getMountIdentity() !== mount)
      throw new Error('workspace changed while the tool was running');
  };
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CLIENT_TOOL_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const result = await settleClientTool(
      req,
      () => runClientTool(req, vfs, opts.openFile, check),
      { signal, timeoutMs },
    );
    return timedOut
      ? { content: `error: ${req.name} timed out after ${timeoutMs}ms`, error: true }
      : result;
  } finally {
    clearTimeout(timer);
  }
}

async function runClientTool(
  req: ClientToolRequest,
  vfs: VirtualFs,
  openFile: ((path: string) => void) | undefined,
  check: () => void,
): Promise<ClientToolResult> {
  try {
    check();
    if (isLocalFileTool(req.name)) return await runLocalFileTool(req, workspaceFs(vfs, check));
    if (req.name === 'local_shell') {
      const command = asString(req.args.command);
      const cwd = asString(req.args.cwd);
      const content = await runLocalShell(command, cwd, vfs, check);
      return {
        content: content || '(ok)',
        ...(content.startsWith('unsupported') ||
        content.startsWith('usage:') ||
        content.startsWith('error:')
          ? { error: true }
          : {}),
      };
    }
    if (req.name === 'local_open') {
      const target = asString(req.args.target);
      if (!target) return { content: 'error: target required', error: true };
      if (/^https?:\/\//i.test(target)) {
        window.open(target, '_blank', 'noopener,noreferrer');
        return { content: JSON.stringify({ opened: target, kind: 'url' }) };
      }
      if (!openFile) {
        return { content: 'error: this client has nowhere to open files', error: true };
      }
      // Checked first, so the pane never opens a tab on a file that is not there
      // and the model hears that it was wrong about the path.
      const cleaned = target.replace(/^\//, '');
      if ((await readExisting(cleaned, vfs)) === null) {
        return { content: `error: no such file: ${cleaned}`, error: true };
      }
      check();
      openFile(cleaned);
      return { content: JSON.stringify({ opened: cleaned, kind: 'file', in: 'side_pane' }) };
    }
    return {
      content: `error: unknown client tool ${req.name}`,
      error: true,
    };
  } catch (err) {
    return { content: `error: ${err instanceof Error ? err.message : String(err)}`, error: true };
  }
}

export { clearMount, getMountLabel, hasMount, mountTree, pickDirectory, supportsDirectoryPicker };
