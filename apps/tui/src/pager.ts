/**
 * Hand a large body to `$PAGER`, the way `editor.ts` hands a prompt to `$EDITOR`.
 *
 * A spilled tool output is tens of thousands of characters. It does not belong
 * in a notice, and building a scrollable viewer for it would be a second
 * transcript — so it goes to the pager the user already has, between
 * `renderer.suspend()` and `renderer.resume()`.
 *
 * The `resume` is in a `finally` for the reason `editor.ts` gives: a pager that
 * exits non-zero must not leave a client that has stopped drawing with no way
 * back. And the command is resolved *before* suspending, because suspending and
 * then discovering there is nothing to run is a blank terminal.
 */

import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** `$PAGER`, then `$VISUAL`/`$EDITOR`, then `less`. Split like a shell would. */
export function pagerCommand(env: NodeJS.ProcessEnv = process.env): string[] | null {
  const raw = env.PAGER || env.VISUAL || env.EDITOR || 'less';
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts : null;
}

/**
 * Write `body` somewhere private and show it.
 *
 * `0700` on the directory and `0600` on the file, the same discipline the thread
 * store uses: this is a copy of tool output, and tool output carries whatever
 * the agent read.
 */
export function page(body: string, name: string): { path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'felix-artifact-'));
  const path = join(dir, name);
  writeFileSync(path, body, { encoding: 'utf8', mode: 0o600 });
  const cmd = pagerCommand();
  if (cmd?.length) {
    const [bin, ...args] = cmd as [string, ...string[]];
    spawnSync(bin, [...args, path], { stdio: 'inherit' });
  }
  return { path };
}
