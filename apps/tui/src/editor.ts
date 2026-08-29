/**
 * The editor escape hatch.
 *
 * The composer is a real editor now — a cursor, word motion, shift+enter for a
 * second line — so this is no longer the *only* way to write a paragraph. It is
 * still the way to write a long one, in the tool you already know, and the
 * terminal has always had that: whatever `$VISUAL` or `$EDITOR` names.
 *
 * The caller hands the terminal over (`renderer.suspend()`, resumed in a
 * `finally`), so the only work here is the file: write what is in the composer,
 * run the editor on it, read it back. The temp file is removed whether or not
 * the editor succeeded — an abandoned edit is not a reason to leave a prompt
 * lying in /tmp.
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * One trailing newline, added by every editor that respects POSIX, is not part
 * of a single-line prompt. On anything already multi-line it is left alone —
 * there the newline may well be meant.
 */
export function normalizePrompt(content: string): string {
  const body = content.endsWith('\r\n')
    ? content.slice(0, -2)
    : content.endsWith('\n')
      ? content.slice(0, -1)
      : content;
  return /[\r\n]/.test(body) ? content : body;
}

/** `$VISUAL` beats `$EDITOR`, split into argv so `code -w` works. */
export function editorCommand(env: NodeJS.ProcessEnv = process.env): string[] | null {
  const raw = (env.VISUAL || env.EDITOR || '').trim();
  if (!raw) return null;
  const parts = raw.split(/\s+/).filter(Boolean);
  return parts.length ? parts : null;
}

export interface OpenEditorOptions {
  value: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
  /** `ignore` is for tests; a real editor needs the terminal. */
  stdio?: 'inherit' | 'ignore';
}

/**
 * Returns the edited text, or `undefined` when the editor left it unchanged or
 * empty — either of which means "never mind", not "send an empty message".
 */
export async function openEditor(options: OpenEditorOptions): Promise<string | undefined> {
  const command = editorCommand(options.env);
  if (!command) throw new Error('no $VISUAL or $EDITOR is set');

  // Its own directory, mode 0700: a draft prompt is as revealing as the thread
  // it belongs to, and a predictable name in a shared /tmp is a file anyone
  // else can sit on top of.
  const dir = mkdtempSync(join(tmpdir(), 'felix-prompt-'));
  const file = join(dir, 'prompt.md');
  try {
    writeFileSync(file, options.value, { encoding: 'utf8', mode: 0o600 });
    await new Promise<void>((resolve, reject) => {
      const [bin, ...args] = command as [string, ...string[]];
      const child = spawn(bin, [...args, file], {
        cwd: options.cwd,
        stdio: options.stdio ?? 'inherit',
        // Windows editors are usually .cmd shims, which cannot be spawned direct.
        shell: process.platform === 'win32',
        ...(options.env ? { env: options.env } : {}),
      });
      child.on('error', reject);
      child.on('exit', (code, signal) => {
        if (code === 0) resolve();
        else
          reject(new Error(`${bin} exited with ${signal ? `signal ${signal}` : `code ${code}`}`));
      });
    });
    const edited = normalizePrompt(readFileSync(file, 'utf8'));
    return edited.trim() && edited !== options.value ? edited : undefined;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
