import { describe, expect, it } from 'bun:test';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { editorCommand, normalizePrompt, openEditor } from '../src/editor';

/**
 * The one place this client hands the terminal to something else.
 *
 * What matters is what comes back: an edit, or nothing at all. "Nothing" has to
 * cover the two ways a person abandons an edit — quitting without saving, and
 * emptying the file — because either one turning into a sent message is worse
 * than the feature is useful.
 */

/** An "editor" that does something to the file it is handed, and exits. */
function fakeEditor(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'felix-editor-'));
  const file = join(dir, 'editor.sh');
  writeFileSync(file, `#!/bin/sh\n${script}\n`);
  chmodSync(file, 0o755);
  return file;
}

const run = (script: string, value: string) =>
  openEditor({
    value,
    cwd: tmpdir(),
    stdio: 'ignore',
    env: { ...process.env, VISUAL: '', EDITOR: fakeEditor(script) },
  });

describe('normalizePrompt', () => {
  it('drops the newline an editor added to a single line', () => {
    expect(normalizePrompt('explain the worker\n')).toBe('explain the worker');
    expect(normalizePrompt('explain the worker\r\n')).toBe('explain the worker');
  });

  it('leaves a multi-line prompt exactly as written', () => {
    expect(normalizePrompt('one\ntwo\n')).toBe('one\ntwo\n');
  });

  it('leaves a line with no trailing newline alone', () => {
    expect(normalizePrompt('no newline')).toBe('no newline');
  });
});

describe('editorCommand', () => {
  it('prefers $VISUAL and splits it into arguments', () => {
    expect(editorCommand({ VISUAL: 'code -w', EDITOR: 'vi' })).toEqual(['code', '-w']);
  });

  it('falls back to $EDITOR', () => {
    expect(editorCommand({ EDITOR: 'vi' })).toEqual(['vi']);
  });

  it('is null when neither is set to anything', () => {
    expect(editorCommand({})).toBeNull();
    expect(editorCommand({ EDITOR: '   ' })).toBeNull();
  });
});

describe('openEditor', () => {
  it('returns what the editor wrote', async () => {
    await expect(run('echo "a longer prompt" > "$1"', 'draft')).resolves.toBe('a longer prompt');
  });

  it('hands the current line to the editor to start from', async () => {
    await expect(run('sed -i.bak "s/half/whole/" "$1"', 'a half thought')).resolves.toBe(
      'a whole thought',
    );
  });

  it('returns nothing when the file comes back unchanged', async () => {
    await expect(run('true', 'unchanged')).resolves.toBeUndefined();
  });

  it('returns nothing when the file is emptied', async () => {
    await expect(run(': > "$1"', 'discard me')).resolves.toBeUndefined();
  });

  it('reports an editor that failed rather than losing the line silently', async () => {
    await expect(run('exit 3', 'kept')).rejects.toThrow(/code 3/);
  });

  it('refuses when no editor is configured', async () => {
    await expect(
      openEditor({ value: 'x', cwd: tmpdir(), stdio: 'ignore', env: { PATH: process.env.PATH } }),
    ).rejects.toThrow(/EDITOR/);
  });
});
