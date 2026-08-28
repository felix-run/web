import {
  type ClientToolOptions,
  type ClientToolRequest,
  type ClientToolResult,
  settleClientTool,
} from '@felix/client';
import {
  clearMount,
  getMountLabel,
  hasMount,
  mountList,
  mountMkdir,
  mountRead,
  mountTree,
  mountWrite,
  pickDirectory,
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

async function runLocalShell(command: string, cwd: string, vfs: VirtualFs): Promise<string> {
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
      if (rest.includes('>')) {
        const idx = rest.indexOf('>');
        const text = rest.slice(0, idx).join(' ');
        const path = rest.slice(idx + 1).join(' ');
        if (!path) return 'usage: echo text > path';
        if (mounted) await mountWrite(join(path), `${text}\n`);
        else vfs.write(join(path), `${text}\n`);
        return '';
      }
      return rest.join(' ');
    }
    case 'mkdir': {
      if (!arg) return 'usage: mkdir <path>';
      if (mounted) await mountMkdir(join(arg));
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
        if (mounted) await mountWrite(path, '');
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
 * Open a workspace file in a new tab.
 *
 * Shared by the `local_open` tool and by clicking a file mention in the
 * transcript, so the two cannot drift on which source wins or how the object
 * URL is cleaned up. Reads mount-first, VFS second — the same precedence every
 * other client tool uses.
 *
 * Returns which source answered. Throws when neither has the file.
 */
export async function openWorkspaceFile(path: string, vfs: VirtualFs): Promise<'mount' | 'vfs'> {
  const cleaned = path.replace(/^\//, '');
  const mounted = hasMount();
  const text = mounted ? await mountRead(cleaned) : vfs.read(cleaned);
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  window.open(url, '_blank', 'noopener,noreferrer');
  // Revoking immediately races the new tab's own load.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return mounted ? 'mount' : 'vfs';
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
  opts: ClientToolOptions = {},
): Promise<ClientToolResult> {
  return settleClientTool(req, () => runClientTool(req, vfs), opts);
}

async function runClientTool(req: ClientToolRequest, vfs: VirtualFs): Promise<ClientToolResult> {
  try {
    if (req.name === 'local_shell') {
      const command = asString(req.args.command);
      const cwd = asString(req.args.cwd);
      const content = await runLocalShell(command, cwd, vfs);
      return { content: content || '(ok)' };
    }
    if (req.name === 'local_open') {
      const target = asString(req.args.target);
      if (!target) return { content: 'error: target required', error: true };
      if (/^https?:\/\//i.test(target)) {
        window.open(target, '_blank', 'noopener,noreferrer');
        return { content: JSON.stringify({ opened: target, kind: 'url' }) };
      }
      try {
        const kind = await openWorkspaceFile(target, vfs);
        return { content: JSON.stringify({ opened: target, kind }) };
      } catch (err) {
        return {
          content: `error: ${err instanceof Error ? err.message : String(err)}`,
          error: true,
        };
      }
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
