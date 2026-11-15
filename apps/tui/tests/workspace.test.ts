import { afterEach, beforeEach, describe, expect, it, vi } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

describe('local_info', () => {
  it.each([false, true])('reports native execution only with shell=%s', async (shell) => {
    const confirm = vi.fn(async () => true);
    const workspace = createWorkspace({ root, shell, confirm });
    const result = await workspace.execute(call('local_info', {}));
    expect(result.error).not.toBe(true);
    const info = JSON.parse(result.content);
    expect(info.client).toBe('terminal');
    expect(info.workspace).toEqual({ kind: 'directory', root });
    expect(info.shell.mode).toBe(shell ? 'native' : 'emulated');
    if (shell) {
      expect(info.shell.confirmation).toBe('always');
      expect(info.shell.sandboxed).toBe(false);
      expect(info.shell.interpreter).toBe('/bin/sh');
    } else {
      expect(info.shell.commands).not.toContain('git');
      expect(info.shell.commands).toContain('cat');
    }
    expect(confirm).not.toHaveBeenCalled();
  });
});

describe('edits while confirmation is pending', () => {
  it('preserves a newer edit and permits a fresh retry', async () => {
    const file = join(root, 'src', 'api.ts');
    let changed = false;
    const workspace = createWorkspace({
      root,
      confirm: async () => {
        if (!changed) {
          writeFileSync(file, 'export const x = 3;\n');
          changed = true;
        }
        return true;
      },
    });
    const stale = await workspace.execute(
      call('local_edit', { path: 'src/api.ts', old_string: '1', new_string: '2' }),
    );
    expect(stale.error).toBe(true);
    expect(stale.content).toContain('changed since it was read');
    expect(readFileSync(file, 'utf8')).toBe('export const x = 3;\n');
    const retry = await workspace.execute(
      call('local_edit', { path: 'src/api.ts', old_string: '3', new_string: '4' }),
    );
    expect(retry.error).not.toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('export const x = 4;\n');
  });

  it('does not recreate a file deleted while confirmation was pending', async () => {
    const file = join(root, 'src', 'api.ts');
    const workspace = createWorkspace({
      root,
      confirm: async () => {
        await import('node:fs/promises').then((fs) => fs.unlink(file));
        return true;
      },
    });
    const result = await workspace.execute(
      call('local_edit', { path: 'src/api.ts', old_string: '1', new_string: '2' }),
    );
    expect(result.error).toBe(true);
    expect(existsSync(file)).toBe(false);
  });
});

describe('local_instructions', () => {
  it('reads applicable instructions from the real project without confirmation', async () => {
    writeFileSync(join(root, 'AGENTS.md'), 'root instructions');
    writeFileSync(join(root, 'src', 'CLAUDE.md'), 'source instructions');
    const confirm = vi.fn(async () => true);
    const result = await createWorkspace({ root, confirm }).execute(
      call('local_instructions', { path: 'src/new.ts' }),
    );
    expect(result.error).not.toBe(true);
    expect(
      JSON.parse(result.content).instructions.map((file: { content: string }) => file.content),
    ).toEqual(['root instructions', 'source instructions']);
    expect(confirm).not.toHaveBeenCalled();
  });

  it('refuses an instruction file symlink outside the workspace', async () => {
    writeFileSync(join(outside, 'instructions.md'), 'outside instructions');
    symlinkSync(join(outside, 'instructions.md'), join(root, 'AGENTS.md'));
    const result = await permissive().execute(call('local_instructions', {}));
    expect(result.error).toBe(true);
    expect(result.content).not.toContain('outside instructions');
  });
});

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

    expect(confirm).toHaveBeenCalledTimes(1);
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

    vi.advanceTimersByTime(31_000);

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

describe('the local_* file tools', () => {
  it('reads and searches under the root without asking', async () => {
    const confirm = vi.fn(async () => true);
    const ws = createWorkspace({ root, confirm });
    expect((await ws.execute(call('local_read', { path: 'src/api.ts' }))).content).toBe(
      'export const x = 1;\n',
    );
    expect((await ws.execute(call('local_search', { query: 'const x' }))).content).toBe(
      'src/api.ts:1:export const x = 1;',
    );
    expect((await ws.execute(call('local_list', {}))).content).toBe('src/');
    expect(confirm).not.toHaveBeenCalled();
  });

  it('asks before a write, naming the absolute path, and writes on yes', async () => {
    const summaries: string[] = [];
    const ws = createWorkspace({
      root,
      confirm: async (s) => {
        summaries.push(s);
        return true;
      },
    });
    await ws.execute(call('local_write', { path: 'notes/a.md', content: 'hi' }));
    expect(summaries).toEqual([`write 2 chars to ${join(root, 'notes', 'a.md')}`]);
    expect(readFileSync(join(root, 'notes', 'a.md'), 'utf8')).toBe('hi');
  });

  it('edits only on yes, and leaves the file alone on no', async () => {
    const refused = await createWorkspace({ root, confirm: async () => false }).execute(
      call('local_edit', { path: 'src/api.ts', old_string: '1', new_string: '2' }),
    );
    expect(refused).toEqual({ content: 'error: refused by the user', error: true });
    expect(readFileSync(join(root, 'src', 'api.ts'), 'utf8')).toBe('export const x = 1;\n');

    await permissive().execute(
      call('local_edit', { path: 'src/api.ts', old_string: '1', new_string: '2' }),
    );
    expect(readFileSync(join(root, 'src', 'api.ts'), 'utf8')).toBe('export const x = 2;\n');
  });

  it('refuses to read or write outside the root, and into .git', async () => {
    writeFileSync(join(outside, 'secret'), 'nope');
    const ws = permissive();
    const read = await ws.execute(call('local_read', { path: join(outside, 'secret') }));
    expect(read.error).toBe(true);
    const climbed = await ws.execute(call('local_write', { path: '../x', content: 'x' }));
    expect(climbed.error).toBe(true);
    const git = await ws.execute(
      call('local_write', { path: '.git/hooks/pre-commit', content: 'x' }),
    );
    expect(git.content).toContain('inside .git/');
    expect(existsSync(join(root, '.git'))).toBe(false);
  });
});

describe('local_delete and local_rename on the working directory', () => {
  it('never overwrites a destination created during rename confirmation', async () => {
    const workspace = createWorkspace({
      root,
      confirm: async () => {
        writeFileSync(join(root, 'new.ts'), 'newer destination');
        return true;
      },
    });
    const result = await workspace.execute(
      call('local_rename', { path: 'src/api.ts', to_path: 'new.ts' }),
    );
    expect(result.error).toBe(true);
    expect(readFileSync(join(root, 'new.ts'), 'utf8')).toBe('newer destination');
    expect(readFileSync(join(root, 'src', 'api.ts'), 'utf8')).toBe('export const x = 1;\n');
  });

  it.each([
    'local_delete',
    'local_rename',
  ])('preserves a changed source during %s confirmation', async (name) => {
    const file = join(root, 'src', 'api.ts');
    const workspace = createWorkspace({
      root,
      confirm: async () => {
        writeFileSync(file, 'newer user work');
        return true;
      },
    });
    const result = await workspace.execute(call(name, { path: 'src/api.ts', to_path: 'new.ts' }));
    expect(result.error).toBe(true);
    expect(result.content).toContain('changed while awaiting approval');
    expect(readFileSync(file, 'utf8')).toBe('newer user work');
    expect(existsSync(join(root, 'new.ts'))).toBe(false);
  });

  it('refuses a source replaced by a symlink during delete confirmation', async () => {
    const file = join(root, 'src', 'api.ts');
    writeFileSync(join(outside, 'secret.ts'), 'outside');
    const workspace = createWorkspace({
      root,
      confirm: async () => {
        unlinkSync(file);
        symlinkSync(join(outside, 'secret.ts'), file);
        return true;
      },
    });
    const result = await workspace.execute(call('local_delete', { path: 'src/api.ts' }));
    expect(result.error).toBe(true);
    expect(readFileSync(file, 'utf8')).toBe('outside');
    expect(readFileSync(join(outside, 'secret.ts'), 'utf8')).toBe('outside');
  });

  it('delete removes a file after a yes that names it absolutely, and nothing without one', async () => {
    writeFileSync(join(root, 'gone.md'), 'x');
    const asked: string[] = [];
    const ws = createWorkspace({
      root,
      confirm: async (what) => {
        asked.push(what);
        return true;
      },
    });
    const out = await ws.execute(call('local_delete', { path: 'gone.md' }));
    expect(out.error).toBeUndefined();
    expect(existsSync(join(root, 'gone.md'))).toBe(false);
    expect(asked).toEqual([`delete ${join(root, 'gone.md')}`]);

    writeFileSync(join(root, 'kept.md'), 'x');
    const refused = await createWorkspace({ root, confirm: async () => false }).execute(
      call('local_delete', { path: 'kept.md' }),
    );
    expect(refused.error).toBe(true);
    expect(existsSync(join(root, 'kept.md'))).toBe(true);
  });

  it('refuses a folder, a link and anything under .git', async () => {
    mkdirSync(join(root, '.git'));
    writeFileSync(join(root, '.git', 'HEAD'), 'ref');
    writeFileSync(join(outside, 'secret.txt'), 'secret');
    symlinkSync(join(outside, 'secret.txt'), join(root, 'link.txt'));
    const ws = permissive();
    expect((await ws.execute(call('local_delete', { path: 'src' }))).error).toBe(true);
    expect((await ws.execute(call('local_delete', { path: '.git/HEAD' }))).error).toBe(true);
    const link = await ws.execute(call('local_delete', { path: 'link.txt' }));
    expect(link.error).toBe(true);
    expect(link.content).toMatch(/symbolic link/);
    // Neither the link's target nor the link was touched.
    expect(readFileSync(join(outside, 'secret.txt'), 'utf8')).toBe('secret');
    expect(existsSync(join(root, 'link.txt'))).toBe(true);
    expect(existsSync(join(root, '.git', 'HEAD'))).toBe(true);
  });

  it('rename moves a file into a new folder, never over another, never out of the root', async () => {
    writeFileSync(join(root, 'a.md'), 'A');
    writeFileSync(join(root, 'b.md'), 'B');
    const ws = permissive();
    const taken = await ws.execute(call('local_rename', { path: 'a.md', to_path: 'b.md' }));
    expect(taken.error).toBe(true);
    expect(readFileSync(join(root, 'b.md'), 'utf8')).toBe('B');
    const climbing = await ws.execute(call('local_rename', { path: 'a.md', to_path: '../x.md' }));
    expect(climbing.error).toBe(true);
    expect(existsSync(join(root, 'a.md'))).toBe(true);
    const moved = await ws.execute(call('local_rename', { path: 'a.md', to_path: 'docs/a.md' }));
    expect(moved.error).toBeUndefined();
    expect(readFileSync(join(root, 'docs', 'a.md'), 'utf8')).toBe('A');
    expect(existsSync(join(root, 'a.md'))).toBe(false);
  });
});

describe('coding workspace', () => {
  it('honors cwd in emulated shell commands', async () => {
    const result = await permissive().execute(
      call('local_shell', { command: 'cat api.ts', cwd: 'src' }),
    );
    expect(result.content).toBe('export const x = 1;\n');
  });

  it('refuses a shell cwd outside the workspace', async () => {
    const result = await permissive().execute(
      call('local_shell', { command: 'pwd', cwd: outside }),
    );
    expect(result.error).toBe(true);
  });

  it('marks unsupported commands as errors', async () => {
    const result = await permissive().execute(call('local_shell', { command: 'git status' }));
    expect(result.error).toBe(true);
  });

  it('runs a real command in cwd only after its own confirmation', async () => {
    const confirmShell = vi.fn(async (_summary: string) => true);
    const ws = createWorkspace({ root, shell: true, confirm: allow, confirmShell });
    const result = await ws.execute(
      call('local_shell', { command: 'pwd; printf hello >&2', cwd: 'src' }),
    );
    expect(result.error).toBeUndefined();
    expect(result.content).toContain(join(root, 'src'));
    expect(result.content).toContain('hello');
    expect(confirmShell.mock.calls[0]?.[0]).toContain('pwd; printf hello >&2');
  });

  it('refuses commands even when file writes are allowed without asking', async () => {
    const ws = createWorkspace({
      root,
      shell: true,
      confirm: allow,
      confirmShell: async () => false,
    });
    const result = await ws.execute(call('local_shell', { command: 'touch never.txt' }));
    expect(result.error).toBe(true);
    expect(existsSync(join(root, 'never.txt'))).toBe(false);
  });

  it('reports a nonzero exit and keeps stderr', async () => {
    const ws = createWorkspace({ root, shell: true, confirm: allow });
    const result = await ws.execute(call('local_shell', { command: 'printf failure >&2; exit 7' }));
    expect(result.error).toBe(true);
    expect(result.content).toContain('failure');
    expect(result.content).toContain('code 7');
  });

  it('cancels a command and permits a later turn', async () => {
    const ws = createWorkspace({ root, shell: true, confirm: allow });
    const pending = ws.execute(call('local_shell', { command: 'sleep 2; touch never.txt' }));
    await Bun.sleep(50);
    ws.cancel();
    expect((await pending).error).toBe(true);
    expect((await ws.execute(call('local_shell', { command: 'printf next' }))).content).toBe(
      'next',
    );
    await Bun.sleep(2100);
    expect(existsSync(join(root, 'never.txt'))).toBe(false);
  });

  it('does not write when confirmation arrives after cancellation', async () => {
    let answer: (ok: boolean) => void = () => {};
    const ws = createWorkspace({
      root,
      confirm: () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    });
    const pending = ws.execute(call('local_write', { path: 'never.txt', content: 'late' }));
    await Bun.sleep(30);
    ws.cancel();
    expect((await pending).error).toBe(true);
    answer(true);
    await Bun.sleep(30);
    expect(existsSync(join(root, 'never.txt'))).toBe(false);
  });
});

describe('local_open', () => {
  it('shows a contained text file through the viewer', async () => {
    const openFile = vi.fn(async (_body: string, _name: string) => {});
    const result = await createWorkspace({ root, confirm: allow, openFile }).execute(
      call('local_open', { target: 'src/api.ts' }),
    );
    expect(result.error).toBeUndefined();
    expect(openFile).toHaveBeenCalledWith('export const x = 1;\n', 'api.ts');
  });
  it('refuses an escaped file without calling the viewer', async () => {
    const openFile = vi.fn(async () => {});
    const result = await createWorkspace({ root, confirm: allow, openFile }).execute(
      call('local_open', { target: join(outside, 'secret') }),
    );
    expect(result.error).toBe(true);
    expect(openFile).not.toHaveBeenCalled();
  });
  it('returns web links without launching a process', async () => {
    const result = await permissive().execute(
      call('local_open', { target: 'https://example.com/docs' }),
    );
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('https://example.com/docs');
  });
});

it('bounds native command output without blocking the child', async () => {
  const ws = createWorkspace({ root, shell: true, confirm: allow });
  const result = await ws.execute(call('local_shell', { command: 'yes x | head -c 210000' }));
  expect(result.error).toBeUndefined();
  expect(result.content).toContain('output truncated at 200000 bytes');
  expect(result.content.length).toBeLessThan(200100);
});

it('reports viewer errors to the model', async () => {
  const ws = createWorkspace({
    root,
    confirm: allow,
    openFile: async () => {
      throw new Error('pager failed');
    },
  });
  const result = await ws.execute(call('local_open', { target: 'src/api.ts' }));
  expect(result.error).toBe(true);
  expect(result.content).toContain('pager failed');
});
