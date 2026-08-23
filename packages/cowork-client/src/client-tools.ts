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

export interface ClientToolRequest {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface PendingApproval {
  approvalId: string;
  toolName: string;
  args: Record<string, unknown>;
  ruleId?: string;
  /** Existing file text for write_file diffs (null = new file / unreadable). */
  before?: string | null;
}

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

/** Wall-clock ceiling for a browser-executed tool. */
export const DEFAULT_CLIENT_TOOL_TIMEOUT_MS = 30_000;

export interface ClientToolOptions {
  /** Abandons the in-flight tool, e.g. when the user stops the run. */
  signal?: AbortSignal;
  /** Overrides {@link DEFAULT_CLIENT_TOOL_TIMEOUT_MS}. */
  timeoutMs?: number;
}

export type ClientToolResult = { content: string; error?: boolean };

/**
 * Run a tool the harness delegated to the browser, and *always settle*.
 *
 * The harness blocks the model loop until it gets a `tool_result`, so the one
 * outcome this must never produce is a promise that neither resolves nor
 * rejects. A directory picker the user ignores, or a mount whose permission was
 * revoked mid-call, would otherwise hang the conversation with nothing shown.
 * Both the timeout and the abort therefore *resolve* with an error result
 * rather than throwing — the caller posts it upstream and the run continues.
 *
 * The race does not cancel the underlying work; nothing here is cancellable.
 * It bounds how long the caller waits, which is the property the run needs.
 */
export async function executeClientTool(
  req: ClientToolRequest,
  vfs: VirtualFs,
  opts: ClientToolOptions = {},
): Promise<ClientToolResult> {
  const { signal, timeoutMs = DEFAULT_CLIENT_TOOL_TIMEOUT_MS } = opts;
  if (signal?.aborted) return { content: `error: ${req.name} aborted`, error: true };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  const bail = new Promise<ClientToolResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ content: `error: ${req.name} timed out after ${timeoutMs}ms`, error: true }),
      timeoutMs,
    );
    if (signal) {
      onAbort = () => resolve({ content: `error: ${req.name} aborted`, error: true });
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });

  try {
    return await Promise.race([runClientTool(req, vfs), bail]);
  } finally {
    clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
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
        const text = hasMount()
          ? await mountRead(target.replace(/^\//, ''))
          : vfs.read(target.replace(/^\//, ''));
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener,noreferrer');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return {
          content: JSON.stringify({
            opened: target,
            kind: hasMount() ? 'mount' : 'vfs',
          }),
        };
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

export function summarizeToolArgs(toolName: string, args: Record<string, unknown>): string {
  if (toolName === 'write_file') {
    const path = typeof args.path === 'string' ? args.path : '?';
    const len = typeof args.content === 'string' ? args.content.length : 0;
    return `Write ${path} (${len} chars)${args.append ? ' append' : ''}`;
  }
  if (toolName === 'local_shell') {
    return `Shell: ${typeof args.command === 'string' ? args.command : JSON.stringify(args)}`;
  }
  if (toolName === 'local_open') {
    return `Open: ${typeof args.target === 'string' ? args.target : JSON.stringify(args)}`;
  }
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

export { clearMount, getMountLabel, hasMount, mountTree, pickDirectory, supportsDirectoryPicker };
