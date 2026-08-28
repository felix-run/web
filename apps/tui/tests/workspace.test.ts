import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspace, PathEscape, resolveWithin } from '../src/workspace';

/**
 * The model chooses these paths.
 *
 * Not the user — the model, from text that may itself have come out of a tool
 * result. Three properties matter, and each is asserted through the **write**,
 * not only through `resolveWithin`: an earlier version of these tests checked
 * containment by calling the resolver and by reading, and a write that escaped
 * through a dangling symlink passed all of them.
 *
 * 1. Nothing lands outside the root, however the path is spelled.
 * 2. No write happens without the confirmation saying yes.
 * 3. Every request settles with a result — never a throw, never a hang.
 */

let root: string;
let outside: string;

beforeEach(() => {
  // Real path, not the symlinked one: macOS hands out /var/… for /private/var/…,
  // and `resolveWithin` answers in real paths so the containment check and the
  // answer cannot disagree.
  root = realpathSync(mkdtempSync(join(tmpdir(), 'felix-tui-')));
  outside = realpathSync(mkdtempSync(join(tmpdir(), 'felix-outside-')));
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src', 'api.ts'), 'export const x = 1;\n');
});

afterEach(() => {
  vi.useRealTimers();
});

const call = (name: string, args: Record<string, unknown>) => ({ id: 'c1', name, args });
const allow = async () => true;
/** A workspace that would say yes — so a refusal in a test is never the prompt's. */
const permissive = () => createWorkspace({ root, confirm: allow });

describe('resolveWithin', () => {
  it('resolves a relative path under the root', async () => {
    await expect(resolveWithin(root, 'src/api.ts')).resolves.toBe(join(root, 'src', 'api.ts'));
  });

  it('refuses a path that climbs out', async () => {
    await expect(resolveWithin(root, '../../etc/passwd')).rejects.toBeInstanceOf(PathEscape);
  });

  it('refuses an absolute path elsewhere', async () => {
    await expect(resolveWithin(root, '/etc/passwd')).rejects.toBeInstanceOf(PathEscape);
  });

  it('refuses a symlink pointing out of the tree', async () => {
    writeFileSync(join(outside, 'secret.txt'), 'no');
    symlinkSync(outside, join(root, 'link'));
    await expect(resolveWithin(root, 'link/secret.txt')).rejects.toBeInstanceOf(PathEscape);
  });

  /**
   * The one that got through. A broken symlink has no real path, so the walk up
   * to the nearest existing ancestor sails past it and answers with the lexical
   * path — which `writeFile` then follows out of the tree.
   */
  it('refuses a dangling symlink, which resolves to nothing but writes somewhere', async () => {
    symlinkSync(join(outside, 'ghost.txt'), join(root, 'dangling'));
    await expect(resolveWithin(root, 'dangling')).rejects.toBeInstanceOf(PathEscape);
  });

  it('follows a symlink that stays inside the root', async () => {
    symlinkSync(join(root, 'src', 'api.ts'), join(root, 'alias.ts'));
    await expect(resolveWithin(root, 'alias.ts')).resolves.toBe(join(root, 'src', 'api.ts'));
  });

  it('allows a file that does not exist yet, inside the root', async () => {
    await expect(resolveWithin(root, 'src/new.ts')).resolves.toBe(join(root, 'src', 'new.ts'));
  });

  it('allows a filename that merely begins with dots', async () => {
    await expect(resolveWithin(root, '..config')).resolves.toBe(join(root, '..config'));
  });
});

describe('containment, asserted through the write', () => {
  it.each([
    ['a path that climbs out', 'echo pwned > ../../escaped.txt'],
    ['an absolute path', `echo pwned > ${'/tmp/felix-should-not-exist.txt'}`],
  ])('refuses %s', async (_label, command) => {
    const result = await permissive().execute(call('local_shell', { command }));
    expect(result.error).toBe(true);
    expect(result.content).toContain('outside the workspace root');
  });

  it('does not write through a dangling symlink', async () => {
    const target = join(outside, 'ghost.txt');
    symlinkSync(target, join(root, 'dangling'));

    const result = await permissive().execute(
      call('local_shell', { command: 'echo pwned > dangling' }),
    );

    expect(result.error).toBe(true);
    expect(existsSync(target)).toBe(false);
  });

  it('does not create a directory outside the root', async () => {
    await permissive().execute(call('local_shell', { command: 'mkdir ../../felix-escape' }));
    expect(existsSync(join(outside, '..', 'felix-escape'))).toBe(false);
  });

  it('does not touch a file outside the root', async () => {
    const target = join(outside, 'touched.txt');
    const result = await permissive().execute(call('local_shell', { command: `touch ${target}` }));
    expect(result.error).toBe(true);
    expect(existsSync(target)).toBe(false);
  });
});

describe('writes that are inside the root but still refused', () => {
  it('will not write into .git, where a file is a command', async () => {
    mkdirSync(join(root, '.git'));
    const result = await permissive().execute(
      call('local_shell', { command: 'echo pager=sh > .git/config' }),
    );
    expect(result.error).toBe(true);
    expect(existsSync(join(root, '.git', 'config'))).toBe(false);
  });

  it('will not overwrite an executable file, which keeps its mode', async () => {
    const hook = join(root, 'run.sh');
    writeFileSync(hook, '#!/bin/sh\necho hi\n');
    chmodSync(hook, 0o755);

    const result = await permissive().execute(
      call('local_shell', { command: 'echo evil > run.sh' }),
    );

    expect(result.error).toBe(true);
    expect(readFileSync(hook, 'utf8')).toContain('echo hi');
    expect(statSync(hook).mode & 0o111).not.toBe(0);
  });
});

describe('the tool surface', () => {
  it('reads a real file', async () => {
    const result = await permissive().execute(call('local_shell', { command: 'cat src/api.ts' }));
    expect(result.content).toBe('export const x = 1;\n');
    expect(result.error).toBeUndefined();
  });

  it('lists a directory', async () => {
    const result = await permissive().execute(call('local_shell', { command: 'ls src' }));
    expect(result.content).toContain('src/api.ts');
  });

  it('answers an unknown tool instead of leaving the run blocked', async () => {
    await expect(permissive().execute(call('sudo_make_me_a_sandwich', {}))).resolves.toMatchObject({
      error: true,
    });
  });

  it('refuses local_open, which has no terminal equivalent', async () => {
    await expect(
      permissive().execute(call('local_open', { target: 'src/api.ts' })),
    ).resolves.toMatchObject({ error: true });
  });
});

describe('confirmation before a write', () => {
  it('writes when the user allows it, and names the absolute path', async () => {
    const summaries: string[] = [];
    const confirm = async (summary: string) => {
      summaries.push(summary);
      return true;
    };
    await createWorkspace({ root, confirm }).execute(
      call('local_shell', { command: 'echo hello > notes.md' }),
    );

    expect(summaries).toHaveLength(1);
    // The relative spelling is the model's; a summary echoing it back cannot be
    // checked against where the write actually lands.
    expect(summaries[0]).toContain(join(root, 'notes.md'));
    expect(readFileSync(join(root, 'notes.md'), 'utf8')).toBe('hello\n');
  });

  it('leaves the file alone when the user refuses, and says so', async () => {
    const result = await createWorkspace({ root, confirm: async () => false }).execute(
      call('local_shell', { command: 'echo hello > notes.md' }),
    );

    expect(result.content).toBe('refused by the user');
    expect(existsSync(join(root, 'notes.md'))).toBe(false);
  });

  it.each([
    ['mkdir', 'mkdir fresh', 'fresh'],
    ['touch', 'touch fresh.txt', 'fresh.txt'],
    ['echo with no space before the redirect', 'echo hi >tight.md', 'tight.md'],
  ])('asks before %s', async (_label, command, path) => {
    const confirm = vi.fn(async () => false);
    await createWorkspace({ root, confirm }).execute(call('local_shell', { command }));

    expect(confirm).toHaveBeenCalledOnce();
    expect(existsSync(join(root, path))).toBe(false);
  });

  it('does not ask before a read', async () => {
    const confirm = vi.fn(async () => true);
    await createWorkspace({ root, confirm }).execute(
      call('local_shell', { command: 'cat src/api.ts' }),
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  /**
   * The prompt IS the run: the engine awaits this. If nobody answers, the
   * executor's deadline resolves what the engine is waiting on — but it cannot
   * cancel the work, so the write must not land when the prompt is answered
   * afterwards. The app's own shorter deadline is what makes that true; this
   * pins the half the executor owns.
   */
  it('settles on its own when the prompt is never answered, and writes nothing', async () => {
    vi.useFakeTimers();
    const ws = createWorkspace({ root, confirm: () => new Promise<boolean>(() => {}) });
    const pending = ws.execute(call('local_shell', { command: 'echo hi > never.md' }));

    await vi.advanceTimersByTimeAsync(31_000);

    await expect(pending).resolves.toMatchObject({ error: true });
    expect(existsSync(join(root, 'never.md'))).toBe(false);
  });
});

describe('readForDiff', () => {
  it('returns the current text an approval would replace', async () => {
    await expect(permissive().readForDiff('src/api.ts')).resolves.toBe('export const x = 1;\n');
  });

  it('is null for a new file, and for one outside the root', async () => {
    await expect(permissive().readForDiff('src/new.ts')).resolves.toBeNull();
    await expect(permissive().readForDiff('../../etc/passwd')).resolves.toBeNull();
  });

  /**
   * Null, not a description of the file. Returning "(… too large to read in
   * full)" had the approval banner report a 250 kB overwrite as replacing 53
   * characters — the one number the user has to judge the blast radius by.
   */
  it('is null for a file too large to read, rather than a message about it', async () => {
    writeFileSync(join(root, 'big.txt'), 'x'.repeat(250_000));
    await expect(permissive().readForDiff('big.txt')).resolves.toBeNull();
  });

  it('is null for a directory', async () => {
    await expect(permissive().readForDiff('src')).resolves.toBeNull();
  });
});
