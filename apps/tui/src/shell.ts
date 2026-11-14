/** Explicitly enabled local process execution. cwd containment is not a sandbox. */
import { spawn } from 'node:child_process';
import type { ClientToolResult } from '@felix/client';
import type { ConfirmFn } from './workspace.js';

const MAX_OUTPUT_BYTES = 200_000;

export async function runNativeShell(
  command: string,
  cwd: string,
  confirm: ConfirmFn,
  signal?: AbortSignal,
  timeoutMs = 240_000,
): Promise<ClientToolResult> {
  if (!command.trim()) return { content: 'error: command is empty', error: true };
  if (signal?.aborted) return { content: 'error: local_shell aborted', error: true };
  if (!(await confirm(`run command in ${cwd}\n${command}`))) {
    return { content: 'refused by the user', error: true };
  }
  if (signal?.aborted) return { content: 'error: local_shell aborted', error: true };

  return await new Promise((resolve) => {
    // A process group lets cancellation kill shell children too. Never inherit
    // stdin/stdout: a child must not read the TUI's keys or corrupt its screen.
    const child = spawn('/bin/sh', ['-c', command], {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks: Buffer[] = [];
    let bytes = 0;
    let truncated = false;
    let finished = false;
    const capture = (chunk: Buffer) => {
      const remaining = MAX_OUTPUT_BYTES - bytes;
      if (chunk.length > remaining) truncated = true;
      if (remaining > 0) {
        const kept = chunk.subarray(0, remaining);
        chunks.push(kept);
        bytes += kept.length;
      }
    };
    const kill = () => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* already exited */
      }
    };
    const finish = (content: string, error = false) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve({ content, ...(error ? { error: true } : {}) });
    };
    const outputWith = (status: string) => {
      const output = Buffer.concat(chunks).toString('utf8');
      const suffix = truncated ? '\n(output truncated at 200000 bytes)' : '';
      return `${output}${suffix}\n${status}`.trim();
    };
    const abort = () => {
      kill();
      finish(outputWith('error: local_shell aborted'), true);
    };
    // Keep below the workspace executor and the manifest's 300-second deadline.
    const timer = setTimeout(() => {
      kill();
      finish(outputWith(`error: local_shell timed out after ${timeoutMs}ms`), true);
    }, timeoutMs);
    child.stdout.on('data', capture);
    child.stderr.on('data', capture);
    child.on('error', (error) => finish(`error: ${error.message}`, true));
    child.on('close', (code, killedBy) => {
      const output = Buffer.concat(chunks).toString('utf8');
      const suffix = truncated ? '\n(output truncated at 200000 bytes)' : '';
      const status =
        code === 0
          ? ''
          : `\nerror: command ${killedBy ? `killed by ${killedBy}` : `exited with code ${code}`}`;
      finish(`${output}${suffix}${status}`.trim() || '(ok)', code !== 0);
    });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
  });
}
