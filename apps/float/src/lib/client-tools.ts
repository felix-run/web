import { vfs } from './vfs';

export interface ClientToolRequest {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Tiny shell against the in-tab VFS — not a host OS shell. */
function runLocalShell(command: string, cwd = ''): string {
  const trimmed = command.trim();
  if (!trimmed) return '';

  const [bin, ...rest] = trimmed.split(/\s+/);
  const arg = rest.join(' ').replace(/^['"]|['"]$/g, '');
  const join = (p: string) => {
    if (!cwd || p.startsWith('/')) return p.replace(/^\//, '');
    return `${cwd.replace(/\/$/, '')}/${p}`.replace(/^\.\//, '');
  };

  switch (bin) {
    case 'pwd':
      return cwd || '/';
    case 'ls': {
      const target = join(arg || '.');
      const entries = vfs.list(target === '' ? '.' : target);
      return entries.map((e) => `${e.type === 'dir' ? 'd' : '-'} ${e.path}`).join('\n') || '(empty)';
    }
    case 'cat': {
      if (!arg) return 'usage: cat <path>';
      return vfs.read(join(arg));
    }
    case 'echo': {
      if (rest.includes('>')) {
        const idx = rest.indexOf('>');
        const text = rest.slice(0, idx).join(' ');
        const path = rest.slice(idx + 1).join(' ');
        if (!path) return 'usage: echo text > path';
        vfs.write(join(path), `${text}\n`);
        return '';
      }
      return rest.join(' ');
    }
    case 'mkdir': {
      if (!arg) return 'usage: mkdir <path>';
      vfs.mkdir(join(arg));
      return '';
    }
    case 'touch': {
      if (!arg) return 'usage: touch <path>';
      try {
        vfs.read(join(arg));
      } catch {
        vfs.write(join(arg), '');
      }
      return '';
    }
    case 'tree':
      return vfs.tree().join('\n') || '(empty)';
    case 'help':
      return 'commands: pwd ls cat echo mkdir touch tree help';
    default:
      return `unsupported in float shell: ${bin}\n(try: pwd ls cat echo mkdir touch tree help)`;
  }
}

export async function executeClientTool(req: ClientToolRequest): Promise<{ content: string; error?: boolean }> {
  try {
    if (req.name === 'local_shell') {
      const command = asString(req.args.command);
      const cwd = asString(req.args.cwd);
      const content = runLocalShell(command, cwd);
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
        const text = vfs.read(target.replace(/^\//, ''));
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        window.open(url, '_blank', 'noopener,noreferrer');
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
        return { content: JSON.stringify({ opened: target, kind: 'vfs' }) };
      } catch (err) {
        return { content: `error: ${err instanceof Error ? err.message : String(err)}`, error: true };
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
