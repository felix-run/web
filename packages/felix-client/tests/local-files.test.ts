import { describe, expect, it } from 'vitest';
import {
  classifyToolResult,
  fileToolOp,
  isLocalFileTool,
  type LocalFs,
  MAX_LIST_ENTRIES,
  runLocalFileTool,
} from '../src';

/**
 * The five operations the browser and the terminal both answer through. These run them over a
 * plain map, because what is pinned here is the *answer the model reads* — the shape, the
 * refusals and the limits — which must not differ between the two clients.
 */
function memoryFs(files: Record<string, string>) {
  const writes: Array<{ path: string; content: string; append: boolean; summary: string }> = [];
  const fs: LocalFs = {
    async list(path) {
      const prefix = path ? `${path}/` : '';
      const seen = new Map<string, 'file' | 'dir'>();
      for (const key of Object.keys(files)) {
        if (!key.startsWith(prefix)) continue;
        const [head, ...rest] = key.slice(prefix.length).split('/');
        if (head) seen.set(`${prefix}${head}`, rest.length ? 'dir' : 'file');
      }
      if (path && seen.size === 0 && !(path in files))
        throw new Error(`no such directory: ${path}`);
      return [...seen]
        .map(([p, type]) => ({ path: p, type }))
        .sort((a, b) => a.path.localeCompare(b.path));
    },
    async read(path) {
      const text = files[path];
      if (text === undefined) throw new Error(`no such file: ${path}`);
      return text;
    },
    async write(path, content, { append, summary }) {
      writes.push({ path, content, append, summary });
      files[path] = append ? (files[path] ?? '') + content : content;
    },
  };
  return { fs, files, writes };
}

const run = (fs: LocalFs, name: string, args: Record<string, unknown>) =>
  runLocalFileTool({ id: 'c1', name, args }, fs);

describe('fileToolOp', () => {
  it('maps both families, and a client-prefixed name, to one operation', () => {
    expect(fileToolOp('write_file')).toBe('write');
    expect(fileToolOp('local_write')).toBe('write');
    expect(fileToolOp('client · local_edit')).toBe('edit');
    expect(fileToolOp('local_shell')).toBeNull();
    expect(fileToolOp('github__create_or_update_file')).toBeNull();
  });

  it('answers only the client family as a local file tool', () => {
    expect(isLocalFileTool('local_read')).toBe(true);
    expect(isLocalFileTool('read_file')).toBe(false);
    expect(isLocalFileTool('local_shell')).toBe(false);
  });
});

describe('local_list', () => {
  it('lists direct entries, directories ending in a slash', async () => {
    const { fs } = memoryFs({ 'README.md': '', '.github/ci.yml': '', 'src/a.ts': '' });
    expect((await run(fs, 'local_list', {})).content).toBe('.github/\nREADME.md\nsrc/');
  });

  it('walks everything when recursive, but not .git or node_modules', async () => {
    const { fs } = memoryFs({
      'src/a.ts': '',
      'src/deep/b.ts': '',
      '.git/HEAD': '',
      'node_modules/x/index.js': '',
    });
    expect((await run(fs, 'local_list', { recursive: true })).content).toBe(
      'src/\nsrc/a.ts\nsrc/deep/\nsrc/deep/b.ts',
    );
  });

  it('says where it stopped rather than passing a cut list off as the folder', async () => {
    const files = Object.fromEntries(
      Array.from({ length: MAX_LIST_ENTRIES + 5 }, (_, i) => [
        `f${String(i).padStart(5, '0')}`,
        '',
      ]),
    );
    const { content } = await run(memoryFs(files).fs, 'local_list', {});
    expect(content.split('\n')).toHaveLength(MAX_LIST_ENTRIES + 1);
    expect(content).toContain(`stopped at ${MAX_LIST_ENTRIES} entries`);
  });

  it('says an empty folder is empty', async () => {
    expect((await run(memoryFs({}).fs, 'local_list', {})).content).toBe('(the folder is empty)');
  });
});

describe('local_read', () => {
  it('returns the whole text of a small file', async () => {
    const { fs } = memoryFs({ 'a.md': 'hello\n' });
    expect(await run(fs, 'local_read', { path: './a.md' })).toEqual({ content: 'hello\n' });
  });

  it('pages, and says how to read on', async () => {
    const { fs } = memoryFs({ 'a.md': 'abcdefghij' });
    const { content } = await run(fs, 'local_read', { path: 'a.md', offset: 2, limit: 3 });
    expect(content).toBe('cde\n[… characters 2–5 of 10; pass offset=5 to read on]');
  });

  it('fails as a result, not a throw, when the file is missing', async () => {
    const result = await run(memoryFs({}).fs, 'local_read', { path: 'gone.md' });
    expect(result).toEqual({ content: 'error: no such file: gone.md', error: true });
  });
});

describe('local_search', () => {
  const files = {
    'src/a.ts': 'const x = 1;\n// TODO: tidy\n',
    'src/b.ts': 'todo lowercase\n// TODO: another\n',
    'bin.dat': 'TODO\0binary',
    '.git/COMMIT_EDITMSG': 'TODO in git',
  };

  it('finds lines as path:line:text, skipping binaries and .git', async () => {
    const { content } = await run(memoryFs({ ...files }).fs, 'local_search', { query: 'TODO' });
    expect(content).toBe('src/a.ts:2:// TODO: tidy\nsrc/b.ts:2:// TODO: another');
  });

  it('takes a regular expression, and refuses an invalid one as a result', async () => {
    const { fs } = memoryFs({ ...files });
    expect((await run(fs, 'local_search', { query: '^todo', regex: true })).content).toBe(
      'src/b.ts:1:todo lowercase',
    );
    expect((await run(fs, 'local_search', { query: '(', regex: true })).error).toBe(true);
  });

  it('stops at max_hits and says so', async () => {
    const { content } = await run(memoryFs({ ...files }).fs, 'local_search', {
      query: 'TODO',
      max_hits: 1,
    });
    expect(content).toBe('src/a.ts:2:// TODO: tidy\n[… stopped at 1 matches]');
  });
});

describe('local_write', () => {
  it('writes, telling the filesystem what to ask the user', async () => {
    const { fs, files, writes } = memoryFs({});
    const result = await run(fs, 'local_write', { path: 'notes/todo.md', content: 'one' });
    expect(result).toEqual({ content: 'wrote 3 chars to notes/todo.md' });
    expect(files['notes/todo.md']).toBe('one');
    expect(writes[0]?.summary).toBe('write 3 chars to');
  });

  it('appends', async () => {
    const { fs, files } = memoryFs({ 'log.md': 'a' });
    await run(fs, 'local_write', { path: 'log.md', content: 'b', append: true });
    expect(files['log.md']).toBe('ab');
  });

  it('reports a refusal from the filesystem as a failed call', async () => {
    const fs: LocalFs = {
      ...memoryFs({}).fs,
      write: async () => {
        throw new Error('refused by the user');
      },
    };
    const result = await run(fs, 'local_write', { path: 'x.md', content: 'x' });
    expect(result).toEqual({ content: 'error: refused by the user', error: true });
    expect(classifyToolResult('client · local_write', result.content)?.kind).toBe('failed');
  });
});

describe('local_edit', () => {
  it('replaces the one occurrence and reports it the way edit_file does', async () => {
    const { fs, files } = memoryFs({ 'a.ts': 'const x = 1;\n' });
    const result = await run(fs, 'local_edit', { path: 'a.ts', old_string: '1', new_string: '2' });
    expect(JSON.parse(result.content)).toEqual({ path: 'a.ts', replacements: 1 });
    expect(files['a.ts']).toBe('const x = 2;\n');
  });

  it('refuses an ambiguous match unless replace_all, and then replaces every one', async () => {
    const { fs, files } = memoryFs({ 'a.ts': 'a a a' });
    const ambiguous = await run(fs, 'local_edit', {
      path: 'a.ts',
      old_string: 'a',
      new_string: 'b',
    });
    expect(ambiguous.error).toBe(true);
    expect(ambiguous.content).toContain('appears 3 times');
    expect(files['a.ts']).toBe('a a a');

    const all = await run(fs, 'local_edit', {
      path: 'a.ts',
      old_string: 'a',
      new_string: 'b',
      replace_all: true,
    });
    expect(JSON.parse(all.content).replacements).toBe(3);
    expect(files['a.ts']).toBe('b b b');
  });

  it('refuses a missing match and writes nothing', async () => {
    const { fs, writes } = memoryFs({ 'a.ts': 'x' });
    const result = await run(fs, 'local_edit', { path: 'a.ts', old_string: 'y', new_string: 'z' });
    expect(result.error).toBe(true);
    expect(writes).toEqual([]);
  });

  it('inserts replacement text literally, even with $ patterns in it', async () => {
    const { fs, files } = memoryFs({ 'a.ts': 'price' });
    await run(fs, 'local_edit', { path: 'a.ts', old_string: 'price', new_string: "$& $' $1" });
    expect(files['a.ts']).toBe("$& $' $1");
  });
});
