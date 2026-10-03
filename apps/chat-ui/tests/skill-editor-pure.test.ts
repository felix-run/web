import { isAllowedPath, isBinaryAssetPath } from '@felix/skill-format';
import { describe, expect, it } from 'vitest';
import {
  buildTree,
  isProtectedPath,
  isTextPath,
  pathsUnder,
  sanitizeAssetFileName,
} from '../src/components/skills/bundle-paths';
import { errorLinesForSkillMd } from '../src/components/skills/frontmatter-lines';
import { highlight, languageForFence, languageForPath } from '../src/components/skills/highlight';

/**
 * The editor's pure halves: which paths it will create, how a tree is drawn,
 * which line a validation issue marks, and the highlighter that writes HTML.
 *
 * The highlighter is the one that matters for safety. Its output goes to
 * `innerHTML` under the textarea, and the text it is handed is agent-written,
 * so every language is held to escaping a hostile tag, an attribute-breaking
 * quote and an ampersand.
 */

describe('bundle paths', () => {
  it('allows the root SKILL.md and plugin.json, and files under the four bundle dirs', () => {
    for (const p of [
      'SKILL.md',
      'plugin.json',
      'scripts/run.py',
      'references/deep/notes.md',
      'assets/data.csv',
      'evals/cases.json',
    ]) {
      expect(isAllowedPath(p)).toBe(true);
    }
  });

  it('refuses what the harness refuses: other roots, bare dirs, traversal, bad segments', () => {
    for (const p of [
      'README.md',
      'lib/util.py',
      'scripts',
      'scripts/../secret',
      '/scripts/run.py',
      'scripts/spaced name.py',
      'scripts//double.py',
      'scripts/./run.py',
      'scripts\\run.py',
      'references/SKILL.md',
    ]) {
      expect(isAllowedPath(p)).toBe(false);
    }
  });

  it('protects only SKILL.md, and knows text from binary', () => {
    expect(isProtectedPath('SKILL.md')).toBe(true);
    expect(isProtectedPath('plugin.json')).toBe(false);
    expect(isTextPath('scripts/run.py')).toBe(true);
    expect(isTextPath('assets/logo.png')).toBe(false);
    expect(isBinaryAssetPath('assets/logo.png')).toBe(true);
    expect(isBinaryAssetPath('assets/logo.svg')).toBe(false);
  });

  it('sanitises an uploaded name into one segment, never empty', () => {
    expect(sanitizeAssetFileName('my logo (final).png')).toBe('my-logo-final-.png');
    expect(sanitizeAssetFileName('já é.png')).toBe('j-.png');
    expect(sanitizeAssetFileName('///')).toBe('asset');
  });

  it('collects only the paths under a directory', () => {
    const files = {
      'SKILL.md': '',
      'scripts/a.py': '',
      'scripts/lib/b.py': '',
      'references/c.md': '',
    };
    expect(pathsUnder(files, 'scripts').sort()).toEqual(['scripts/a.py', 'scripts/lib/b.py']);
    expect(pathsUnder(files, 'script')).toEqual([]);
  });

  it('pins SKILL.md first, then root files, then dirs, and keeps pending empty dirs', () => {
    const tree = buildTree({
      'references/notes.md': '',
      'SKILL.md': '',
      'plugin.json': '',
      'scripts/run.py': '',
    });
    expect(tree.map((n) => n.path)).toEqual(['SKILL.md', 'plugin.json', 'references', 'scripts']);
    expect(tree[3]?.children?.map((n) => n.path)).toEqual(['scripts/run.py']);
    const pending = buildTree({ 'SKILL.md': '' }, ['assets']);
    expect(pending.map((n) => n.path)).toEqual(['SKILL.md', 'assets']);
    expect(pending[1]?.children).toEqual([]);
  });
});

describe('errorLinesForSkillMd', () => {
  const content = '---\nname: Bad Name\ndescription: ok\ncompatibility: x\n---\nbody';

  it('maps frontmatter field issues to their yaml line', () => {
    const lines = errorLinesForSkillMd(content, [
      { path: 'frontmatter.name', message: 'invalid' },
      { path: 'frontmatter.compatibility', message: 'too long' },
    ]);
    expect([...lines].sort()).toEqual([2, 4]);
  });

  it('anchors structural and unmatched issues to line 1, and ignores file-path ones', () => {
    expect([
      ...errorLinesForSkillMd(content, [
        { path: 'SKILL.md', message: 'missing frontmatter' },
        { path: 'frontmatter.license', message: 'nope' },
      ]),
    ]).toEqual([1]);
    expect(errorLinesForSkillMd(content, [{ path: 'lib/x.py', message: 'unexpected' }]).size).toBe(
      0,
    );
  });
});

describe('highlight', () => {
  const LANGS = ['markdown', 'yaml', 'python', 'shell', 'javascript', 'json', 'plain'] as const;

  it('maps extensions and fence info strings', () => {
    expect(languageForPath('SKILL.md')).toBe('markdown');
    expect(languageForPath('scripts/run.py')).toBe('python');
    expect(languageForPath('scripts/build.sh')).toBe('shell');
    expect(languageForPath('plugin.json')).toBe('json');
    expect(languageForPath('assets/data.csv')).toBe('plain');
    expect(languageForFence('Python')).toBe('python');
    expect(languageForFence('bash')).toBe('shell');
    expect(languageForFence('rust')).toBe('plain');
    expect(languageForFence(undefined)).toBe('plain');
  });

  it('escapes every hostile byte in every language', () => {
    const hostile = '<img src=x onerror="alert(1)">&<script>"</script>';
    for (const lang of LANGS) {
      const out = highlight(hostile, lang);
      expect(out).not.toMatch(/<(img|script)/);
      expect(out).not.toContain('"alert');
      expect(out).toContain('&lt;');
      expect(out).toContain('&amp;');
    }
  });

  it('marks frontmatter fences, yaml keys and headings in markdown', () => {
    const lines = highlight('---\nname: roll-dice\n---\n# Title\n', 'markdown').split('\n');
    expect(lines[0]).toContain('tok-fence');
    expect(lines[1]).toContain('tok-property');
    expect(lines[2]).toContain('tok-fence');
    expect(lines[3]).toContain('tok-heading');
  });

  it('treats a code fence interior as plain, and closes it', () => {
    const lines = highlight('```py\nx = 1\n```\n# Head', 'markdown').split('\n');
    expect(lines[1]).not.toContain('tok-');
    expect(lines[3]).toContain('tok-heading');
  });

  it('keeps the line count, which the caret alignment depends on', () => {
    const input = 'a\n\nb\nc\n';
    for (const lang of LANGS) expect(highlight(input, lang).split('\n')).toHaveLength(5);
  });

  it('tracks python triple-quoted strings across lines, and not a self-closed one', () => {
    const lines = highlight('x = """\ninside # not a comment\n"""\ny = 1', 'python').split('\n');
    expect(lines[1]).toContain('tok-string');
    expect(lines[1]).not.toContain('tok-comment');
    expect(lines[3]).toContain('tok-number');
    expect(highlight('x = """doc"""\ny = 2', 'python').split('\n')[1]).toContain('tok-number');
  });

  it('tells json keys from string values', () => {
    const out = highlight('{"name": "value"}', 'json');
    expect(out).toContain('tok-property');
    expect(out).toContain('tok-string');
  });
});

describe('highlight cost', () => {
  // A sticky pattern is tried at every position of a line, so one unbounded
  // span made these quadratic: a 256 KiB line of `[` took minutes. The budget
  // is generous on purpose — a linear pass takes milliseconds, a quadratic one
  // takes orders of magnitude longer, and CI machines vary by far less.
  const BUDGET_MS = 1000;
  const hostile = {
    'a 256 KiB line of [': '['.repeat(256 * 1024),
    'a 256 KiB line of **': '**a'.repeat(87_000),
    'a 256 KiB line of backticks and brackets': '`[('.repeat(87_000),
    'a just-tokenized line of [': '['.repeat(3999),
    'a just-tokenized line of ** with no close': `**${'a '.repeat(1998)}`,
    'many just-tokenized lines': `${'[!['.repeat(1333)}\n`.repeat(64),
  };

  it.each(Object.entries(hostile))('highlights %s within budget, escaped', (_label, text) => {
    for (const lang of ['markdown', 'yaml', 'python', 'shell', 'javascript', 'json'] as const) {
      const started = performance.now();
      const out = highlight(text, lang);
      expect(performance.now() - started).toBeLessThan(BUDGET_MS);
      expect(out).not.toContain('<script');
    }
  });

  it('draws an over-long line plain rather than tokenizing it', () => {
    const line = `# ${'x'.repeat(5000)} \`code\``;
    expect(highlight(line, 'shell')).not.toContain('tok-');
  });
});
