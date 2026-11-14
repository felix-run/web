import { afterEach, describe, expect, it, vi } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runNativeShell } from '../src/shell';

const roots: string[] = [];
const folder = () => {
  const root = mkdtempSync(join(tmpdir(), 'felix-shell-'));
  roots.push(root);
  return root;
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('native shell deadline', () => {
  it('kills the command at the deadline and keeps its diagnostic output', async () => {
    const root = folder();
    const pending = runNativeShell(
      'printf started; sleep 2; touch never.txt',
      root,
      async () => true,
      undefined,
      100,
    );
    const result = await pending;
    expect(result.error).toBe(true);
    expect(result.content).toContain('timed out');
    expect(result.content).toContain('started');
    await Bun.sleep(2100);
    expect(existsSync(join(root, 'never.txt'))).toBe(false);
  });

  it('does not start a command when approval arrives after cancellation', async () => {
    const root = folder();
    const controller = new AbortController();
    let answer!: (ok: boolean) => void;
    const pending = runNativeShell(
      'touch never.txt',
      root,
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
      controller.signal,
    );
    controller.abort();
    answer(true);
    expect((await pending).error).toBe(true);
    expect(existsSync(join(root, 'never.txt'))).toBe(false);
  });

  it('never asks or spawns for an already aborted command', async () => {
    const confirm = vi.fn(async () => true);
    const result = await runNativeShell('touch never.txt', folder(), confirm, AbortSignal.abort());
    expect(result.error).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
});
