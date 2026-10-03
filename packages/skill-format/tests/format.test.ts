import { describe, expect, it } from 'vitest';
import {
  bundlePathIssue,
  createSkillTemplate,
  encodeBase64,
  extractDiscoveryMeta,
  isAllowedPath,
  MAX_BUNDLE_FILES,
  MAX_SKILL_MD_CHARS,
  parseSkillMd,
  serializeSkillMd,
  updateSkillMdFrontmatter,
  validateSkillBundle,
  validateSkillName,
} from '../src';

/**
 * The bundle rules, held to the harness's `felix/skills/format.py`.
 *
 * The editor validates as the operator types and the harness validates the
 * save. Where they disagree the editor either blocks a save the harness would
 * take or — the worse direction — offers one it will refuse, so the stricter
 * server rules each get a case here: the path allowlist, the size caps, the
 * anchor refusal, the name rule and its exact message.
 */

const md = (frontmatter: string, body = '# Body\n') => `---\n${frontmatter}\n---\n${body}`;
const errorsOf = (files: Record<string, string>, slug?: string) => {
  const result = validateSkillBundle(files, slug);
  return result.valid ? [] : result.errors;
};

describe('validateSkillName', () => {
  it('accepts a valid name matching its slug', () => {
    expect(validateSkillName('pdf-processing', 'pdf-processing')).toEqual([]);
  });

  it('reports exactly one shape issue, with the harness message', () => {
    // The permissive original reported a regex miss and a hyphen rule for the
    // same name; the harness reports the first rule broken, once.
    expect(validateSkillName('-bad--name')).toEqual([
      {
        path: 'name',
        message:
          'name may only contain lowercase letters, numbers, and hyphens; no leading/trailing/consecutive hyphens',
      },
    ]);
    expect(validateSkillName('a'.repeat(65))).toEqual([
      { path: 'name', message: 'name must be 1-64 characters' },
    ]);
  });

  it('rejects uppercase and a slug mismatch', () => {
    expect(validateSkillName('PDF-processing')).toHaveLength(1);
    expect(validateSkillName('other', 'pdf-processing')).toEqual([
      { path: 'name', message: 'name must match skill slug "pdf-processing"' },
    ]);
  });
});

describe('the path allowlist', () => {
  it.each([
    'plugin.json',
    'scripts/run.py',
    'references/deep/notes.md',
    'assets/logo.png',
    'evals/cases.json',
  ])('allows %s', (path) => {
    expect(bundlePathIssue(path)).toBeNull();
  });

  it.each([
    ['README.md', 'unexpected file path'],
    ['lib/util.py', 'unexpected file path'],
    ['scripts', 'unexpected file path'],
    ['scripts/../secret', "must not contain '..'"],
    ['scripts/./run.py', "must not contain '..'"],
    ['scripts//run.py', "must not contain '..'"],
    ['/scripts/run.py', "must not contain '..'"],
    ['scripts\\run.py', "must not contain '..'"],
    ['scripts/spaced name.py', 'each path segment'],
    [`scripts/${'a'.repeat(129)}`, 'each path segment'],
    ['references/SKILL.md', 'SKILL.md belongs only at the bundle root'],
  ])('refuses %s', (path, message) => {
    expect(bundlePathIssue(path)).toContain(message);
  });

  it('counts the root SKILL.md as allowed for the editor, and nowhere else', () => {
    expect(isAllowedPath('SKILL.md')).toBe(true);
    expect(isAllowedPath('scripts/SKILL.md')).toBe(false);
  });
});

describe('validateSkillBundle', () => {
  it('validates a minimal skill', () => {
    const result = validateSkillBundle(createSkillTemplate('roll-dice', 'Roll dice.'), 'roll-dice');
    expect(result.valid).toBe(true);
    if (result.valid) expect(result.frontmatter.name).toBe('roll-dice');
  });

  it('serialises a description holding a colon rather than interpolating it', () => {
    const result = validateSkillBundle(createSkillTemplate('my-skill', 'Agent skill: my skill'));
    expect(result.valid && result.frontmatter.description).toBe('Agent skill: my skill');
  });

  it('requires SKILL.md, and frontmatter in it', () => {
    expect(errorsOf({})).toEqual([{ path: 'SKILL.md', message: 'SKILL.md is required' }]);
    expect(errorsOf({ 'SKILL.md': '# No frontmatter' })[0]?.message).toContain(
      'must contain YAML frontmatter',
    );
  });

  it('words a missing field as the harness model does', () => {
    expect(errorsOf({ 'SKILL.md': md('name: a') })).toEqual([
      { path: 'frontmatter.description', message: 'Field required' },
    ]);
  });

  it('holds the name to the slug it is saved under', () => {
    expect(errorsOf(createSkillTemplate('other', 'x'), 'mine')).toContainEqual({
      path: 'frontmatter.name',
      message: 'name must match skill slug "mine"',
    });
  });

  it('refuses YAML anchors and aliases', () => {
    const anchored = md('name: a\ndescription: &d hello\nlicense: *d');
    expect(parseSkillMd(anchored)).toBeNull();
    expect(errorsOf({ 'SKILL.md': anchored })[0]?.message).toContain('no anchors or aliases');
  });

  it('refuses nesting past the depth cap', () => {
    const deep = `${'['.repeat(40)}${']'.repeat(40)}`;
    expect(parseSkillMd(md(`name: a\ndescription: b\nx: ${deep}`))).toBeNull();
  });

  it('keeps an unknown key only when it is flat', () => {
    expect(errorsOf({ 'SKILL.md': md('name: a\ndescription: b\ntags: [x, y]') })).toEqual([]);
    expect(errorsOf({ 'SKILL.md': md('name: a\ndescription: b\nnested: {a: {b: 1}}') })).toEqual([
      { path: 'frontmatter.nested', message: 'must be a scalar, or a flat list or map of scalars' },
    ]);
  });

  it('requires metadata values to be strings', () => {
    expect(
      errorsOf({ 'SKILL.md': md('name: a\ndescription: b\nmetadata:\n  version: 1.10') }),
    ).toEqual([
      { path: 'frontmatter.metadata.version', message: 'Input should be a valid string' },
    ]);
  });

  it('counts lengths in code points, as Python does', () => {
    // 1024 emoji are 2048 UTF-16 units and 1024 code points: valid to the harness.
    const description = '😀'.repeat(1024);
    expect(errorsOf({ 'SKILL.md': serializeSkillMd({ name: 'a', description }, '') })).toEqual([]);
  });

  it('caps the file count, and stops there', () => {
    const files: Record<string, string> = { 'SKILL.md': md('name: a\ndescription: b') };
    for (let i = 0; i <= MAX_BUNDLE_FILES; i++) files[`references/n${i}.md`] = 'x';
    expect(errorsOf(files)).toEqual([
      { path: 'bundle', message: `a bundle may hold at most ${MAX_BUNDLE_FILES} files` },
    ]);
  });

  it('caps SKILL.md', () => {
    const big = md('name: a\ndescription: b', 'x'.repeat(MAX_SKILL_MD_CHARS));
    expect(errorsOf({ 'SKILL.md': big })).toEqual([
      { path: 'SKILL.md', message: 'SKILL.md may be at most 256 KiB' },
    ]);
  });

  it('allows plugin.json at the root and a valid binary asset under assets/', () => {
    const bundle = createSkillTemplate('my-skill', 'With a logo.');
    bundle['plugin.json'] = JSON.stringify({ name: 'my-skill' });
    bundle['assets/logo.png'] = encodeBase64(new Uint8Array([137, 80, 78, 71]));
    expect(errorsOf(bundle, 'my-skill')).toEqual([]);
  });

  it('rejects a binary asset outside assets/, bad base64, and an oversized asset', () => {
    const bundle = createSkillTemplate('my-skill', 'Assets.');
    bundle['scripts/logo.png'] = encodeBase64(new Uint8Array([1, 2, 3]));
    bundle['assets/bad.png'] = 'not valid base64!!';
    bundle['assets/huge.png'] = encodeBase64(new Uint8Array(5 * 1024 * 1024 + 1024));
    const errors = errorsOf(bundle, 'my-skill');
    expect(errors).toContainEqual({
      path: 'scripts/logo.png',
      message: 'binary assets (images, PDFs, archives) must live under assets/',
    });
    expect(errors.some((e) => e.path === 'assets/bad.png' && /valid base64/.test(e.message))).toBe(
      true,
    );
    expect(errors.some((e) => e.path === 'assets/huge.png' && /5MB limit/.test(e.message))).toBe(
      true,
    );
  });

  it('rejects a traversal path instead of skipping it', () => {
    const bundle = createSkillTemplate('my-skill', 'Escapes.');
    bundle['../../etc/cron.d/evil'] = '* * * * * root sh';
    expect(errorsOf(bundle).some((e) => e.path === '../../etc/cron.d/evil')).toBe(true);
  });
});

describe('parseSkillMd', () => {
  it('splits yaml text, parsed frontmatter and body', () => {
    const parsed = parseSkillMd('---\nname: roll-dice\ndescription: Roll dice.\n---\n# Body\n');
    expect(parsed?.yamlText).toBe('name: roll-dice\ndescription: Roll dice.');
    expect(parsed?.frontmatter).toEqual({ name: 'roll-dice', description: 'Roll dice.' });
    expect(parsed?.body).toBe('# Body\n');
  });

  it('handles CRLF fences, and a fence line with trailing spaces', () => {
    expect(parseSkillMd('---\r\nname: a\r\ndescription: b\r\n---\r\n# Body')?.body).toBe('# Body');
    expect(parseSkillMd('---  \nname: a\ndescription: b\n---\t\nbody')?.body).toBe('body');
  });

  it('returns null on missing fences or invalid yaml', () => {
    expect(parseSkillMd('# no frontmatter')).toBeNull();
    expect(parseSkillMd('---\n: [broken\n---\nbody')).toBeNull();
  });

  it('reads a date as text, as the harness does', () => {
    expect(parseSkillMd(md('name: a\ndescription: b\nupdated: 2026-01-01'))?.frontmatter).toEqual({
      name: 'a',
      description: 'b',
      updated: '2026-01-01',
    });
  });
});

describe('serializeSkillMd / updateSkillMdFrontmatter', () => {
  it('round-trips with a stable key order', () => {
    const fm = {
      'allowed-tools': 'Bash Read',
      description: 'Roll dice.',
      metadata: { author: 'felix' },
      name: 'roll-dice',
    };
    const content = serializeSkillMd(fm, '# Body\n');
    expect(content).toBe(
      '---\nname: roll-dice\ndescription: Roll dice.\nmetadata:\n  author: felix\nallowed-tools: Bash Read\n---\n# Body\n',
    );
    expect(parseSkillMd(content)?.frontmatter).toEqual(fm);
  });

  it('does not fold a long value across lines', () => {
    const description = `${'Extracts text and tables from PDF files. '.repeat(6)}End.`;
    expect(serializeSkillMd({ name: 'pdf', description }, '')).toBe(
      `---\nname: pdf\ndescription: ${description}\n---\n`,
    );
  });

  it('keeps the body byte-identical and drops yaml comments', () => {
    const body = '# Title\n\n```py\nx = 1\n```\n\ntrailing  spaces  \n';
    const content = `---\n# a comment\nname: a\ndescription: b\n---\n${body}`;
    const updated = updateSkillMdFrontmatter(content, { name: 'a', description: 'changed' });
    expect(parseSkillMd(updated)?.body).toBe(body);
    expect(updated).not.toContain('# a comment');
  });

  it('wraps content lacking frontmatter', () => {
    const updated = updateSkillMdFrontmatter('just a body', { name: 'a', description: 'b' });
    expect(parseSkillMd(updated)?.body).toBe('just a body');
  });
});

describe('extractDiscoveryMeta', () => {
  it('reads name and description off a valid bundle, and nothing off an invalid one', () => {
    expect(extractDiscoveryMeta(createSkillTemplate('a-b', 'Does a thing.'))).toEqual({
      name: 'a-b',
      description: 'Does a thing.',
    });
    expect(extractDiscoveryMeta({ 'SKILL.md': '# none' })).toBeNull();
  });
});
