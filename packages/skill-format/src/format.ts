/**
 * The SKILL.md format (agentskills.io): YAML frontmatter, bundle layout, templates.
 *
 * This is a mirror, not an authority. The harness validates every save with
 * `felix/skills/format.py`, and what it says is what happens; this exists so an
 * editor can say the same thing *while the operator types* rather than after a
 * round trip. So the rules are the harness's stricter ones, spelled to produce
 * the same messages, and a disagreement between the two is a bug here:
 *
 * - Bundle paths are an allowlist: `plugin.json`, or a first segment of
 *   `scripts`, `references`, `assets` or `evals` followed by segments of
 *   `[A-Za-z0-9._-]{1,128}`. No empty, `.` or `..` segment, no backslash, and
 *   `SKILL.md` only at the root.
 * - A bundle is capped in SKILL.md size, file count and total bytes, and its
 *   frontmatter in size and nesting depth.
 * - YAML anchors and aliases are refused: frontmatter has no use for them, and
 *   an alias is how a few lines of YAML expand into a very large document.
 * - An unknown frontmatter key must hold a scalar or a flat list or map of them.
 * - Lengths are counted in code points, as Python counts them, not UTF-16 units.
 *
 * A bundle is a plain `path → content` record here, the shape the wire carries.
 */

import { isCollection, isNode, parseDocument, stringify, visit } from 'yaml';
import {
  base64DecodedSize,
  isBinaryAssetPath,
  isValidBase64,
  MAX_BINARY_ASSET_BYTES,
} from './binary';

export type SkillBundle = Record<string, string>;

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
  'allowed-tools'?: string;
  [extra: string]: unknown;
}

export type ValidationResult =
  | { valid: true; frontmatter: SkillFrontmatter; body: string; errors: [] }
  | { valid: false; errors: ValidationIssue[] };

export const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const BUNDLE_DIRS = ['scripts', 'references', 'assets', 'evals'] as const;
export const ALLOWED_ROOT_FILES = ['plugin.json'] as const;
const SEGMENT_RE = /^[A-Za-z0-9._-]{1,128}$/;

// `[\s\S]` is any character including a newline: the Python pattern runs DOTALL.
const FRONTMATTER_RE = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n([\s\S]*)$/;

export const MAX_FRONTMATTER_CHARS = 64 * 1024;
export const MAX_FRONTMATTER_DEPTH = 32;
export const MAX_SKILL_MD_CHARS = 256 * 1024;
export const MAX_BUNDLE_FILES = 200;
export const MAX_BUNDLE_BYTES = 8 * 1024 * 1024;

const NAME_LENGTH_MESSAGE = 'name must be 1-64 characters';
const NAME_CHARS_MESSAGE =
  'name may only contain lowercase letters, numbers, and hyphens; no leading/trailing/consecutive hyphens';
const ESCAPE_MESSAGE = "file path must be relative and must not contain '..' or a leading slash";

const KEY_ORDER = [
  'name',
  'description',
  'license',
  'compatibility',
  'metadata',
  'allowed-tools',
] as const;

/** Length in code points, which is what the harness's `len()` measures. */
export function codePoints(text: string): number {
  let n = 0;
  for (const _ of text) n++;
  return n;
}

function nameProblem(name: string): string | null {
  const length = codePoints(name);
  if (length < 1 || length > 64) return NAME_LENGTH_MESSAGE;
  if (!SKILL_NAME_RE.test(name)) return NAME_CHARS_MESSAGE;
  return null;
}

export function isValidSkillName(name: string): boolean {
  return nameProblem(name) === null;
}

/** At most one issue for the name's shape, plus one when it differs from `slug`. */
export function validateSkillName(name: string, slug?: string): ValidationIssue[] {
  const errors: ValidationIssue[] = [];
  const problem = nameProblem(name);
  if (problem) errors.push({ path: 'name', message: problem });
  if (slug && name !== slug) {
    errors.push({ path: 'name', message: `name must match skill slug "${slug}"` });
  }
  return errors;
}

/** `[yamlText, body]` between the `---` fences, or null when there are none. */
export function splitFrontmatter(content: string): [string, string] | null {
  const match = FRONTMATTER_RE.exec(content);
  if (!match) return null;
  return [match[1] ?? '', match[2] ?? ''];
}

function depthOf(value: unknown, depth = 0): number {
  if (depth > MAX_FRONTMATTER_DEPTH) return depth;
  if (Array.isArray(value)) {
    return value.reduce<number>((d, v) => Math.max(d, depthOf(v, depth + 1)), depth + 1);
  }
  if (value && typeof value === 'object') {
    return Object.values(value).reduce<number>(
      (d, v) => Math.max(d, depthOf(v, depth + 1)),
      depth + 1,
    );
  }
  return depth;
}

/**
 * Split a SKILL.md; null when the fences are missing or the YAML is refused —
 * because it does not parse, is over `MAX_FRONTMATTER_CHARS`, nests past
 * `MAX_FRONTMATTER_DEPTH`, or holds any anchor or alias.
 */
export function parseSkillMd(
  content: string,
): { yamlText: string; frontmatter: unknown; body: string } | null {
  const parts = splitFrontmatter(content);
  if (!parts) return null;
  const [yamlText, body] = parts;
  if (codePoints(yamlText) > MAX_FRONTMATTER_CHARS) return null;
  const doc = parseDocument(yamlText, { version: '1.2', schema: 'core' });
  if (doc.errors.length > 0) return null;
  let anchored = false;
  visit(doc, {
    Alias() {
      anchored = true;
      return visit.BREAK;
    },
    Node(_key, node) {
      if (isNode(node) && node.anchor) {
        anchored = true;
        return visit.BREAK;
      }
      return undefined;
    },
  });
  if (anchored) return null;
  // Collections only count toward depth; a deep scalar is not a bomb.
  if (isCollection(doc.contents)) {
    const value = doc.toJS();
    if (depthOf(value) > MAX_FRONTMATTER_DEPTH) return null;
    return { yamlText, frontmatter: value, body };
  }
  return { yamlText, frontmatter: doc.toJS(), body };
}

function stringifyFrontmatter(frontmatter: Record<string, unknown>): string {
  const ordered: Record<string, unknown> = {};
  for (const key of KEY_ORDER) {
    const value = frontmatter[key];
    if (value !== undefined && value !== null) ordered[key] = value;
  }
  for (const [key, value] of Object.entries(frontmatter)) {
    if (!(key in ordered) && value !== undefined && value !== null) ordered[key] = value;
  }
  // `lineWidth: 0` disables folding: a long description stays one line, so
  // editing any other field does not reformat text the author did not touch.
  return stringify(ordered, { lineWidth: 0 }).trimEnd();
}

export function serializeSkillMd(frontmatter: Record<string, unknown>, body: string): string {
  return `---\n${stringifyFrontmatter(frontmatter)}\n---\n${body}`;
}

/**
 * Regenerate only the YAML between the fences; the body stays byte-identical.
 * Comments and custom key order inside the block are not preserved. Content
 * with no frontmatter becomes the body of a new SKILL.md.
 */
export function updateSkillMdFrontmatter(
  content: string,
  frontmatter: Record<string, unknown>,
): string {
  const parts = splitFrontmatter(content);
  return serializeSkillMd(frontmatter, parts ? parts[1] : content);
}

/** Why `path` may not name a file in a bundle, or null. An allowlist. */
export function bundlePathIssue(path: string): string | null {
  if ((ALLOWED_ROOT_FILES as readonly string[]).includes(path)) return null;
  const segments = path.split('/');
  if (path.includes('\\') || segments.some((s) => s === '' || s === '.' || s === '..')) {
    return ESCAPE_MESSAGE;
  }
  if (!segments.every((s) => SEGMENT_RE.test(s))) {
    return "each path segment must be 1-128 characters of A-Z, a-z, 0-9, '.', '_' or '-'";
  }
  if (segments.length < 2 || !(BUNDLE_DIRS as readonly string[]).includes(segments[0] ?? '')) {
    return 'unexpected file path; use scripts/, references/, assets/, or evals/';
  }
  if (segments[segments.length - 1] === 'SKILL.md')
    return 'SKILL.md belongs only at the bundle root';
  return null;
}

/** Whether a bundle may hold a file at `path` — the root SKILL.md included. */
export function isAllowedPath(path: string): boolean {
  return path === 'SKILL.md' || bundlePathIssue(path) === null;
}

function fileIssues(path: string, content: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  if (isBinaryAssetPath(path) && !path.startsWith('assets/')) {
    issues.push({
      path,
      message: 'binary assets (images, PDFs, archives) must live under assets/',
    });
  }
  const problem = bundlePathIssue(path);
  if (problem) {
    issues.push({ path, message: problem });
    return issues;
  }
  if (path.startsWith('assets/') && isBinaryAssetPath(path)) {
    if (!isValidBase64(content)) {
      issues.push({ path, message: 'binary asset content must be valid base64' });
    } else if (base64DecodedSize(content) > MAX_BINARY_ASSET_BYTES) {
      issues.push({
        path,
        message: `binary asset exceeds the ${MAX_BINARY_ASSET_BYTES / (1024 * 1024)}MB limit`,
      });
    }
  }
  return issues;
}

const encoder = new TextEncoder();

/** UTF-8 bytes, the unit the harness's bundle cap is in. */
export function utf8Bytes(text: string): number {
  return encoder.encode(text).length;
}

function sizeIssues(files: SkillBundle, skillMd: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const paths = Object.keys(files);
  if (paths.length > MAX_BUNDLE_FILES) {
    issues.push({ path: 'bundle', message: `a bundle may hold at most ${MAX_BUNDLE_FILES} files` });
  }
  const total = paths.reduce((sum, p) => sum + utf8Bytes(files[p] ?? ''), 0);
  if (total > MAX_BUNDLE_BYTES) {
    issues.push({
      path: 'bundle',
      message: `a bundle may total at most ${MAX_BUNDLE_BYTES / (1024 * 1024)} MiB`,
    });
  }
  if (codePoints(skillMd) > MAX_SKILL_MD_CHARS) {
    issues.push({
      path: 'SKILL.md',
      message: `SKILL.md may be at most ${MAX_SKILL_MD_CHARS / 1024} KiB`,
    });
  }
  return issues;
}

const isScalar = (v: unknown) =>
  v === null || ['string', 'number', 'boolean'].includes(typeof v) || typeof v === 'bigint';
const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof Date);

function stringField(
  fm: Record<string, unknown>,
  key: string,
  opts: { required?: boolean; min?: number; max?: number },
): string | null {
  if (!(key in fm) || (fm[key] === null && !opts.required)) {
    return opts.required ? 'Field required' : null;
  }
  const value = fm[key];
  if (typeof value !== 'string') return 'Input should be a valid string';
  const length = codePoints(value);
  if (opts.min !== undefined && length < opts.min) {
    return `String should have at least ${opts.min} character${opts.min === 1 ? '' : 's'}`;
  }
  if (opts.max !== undefined && length > opts.max) {
    return `String should have at most ${opts.max} characters`;
  }
  return null;
}

/** The frontmatter schema's issues, worded as the harness's pydantic model words them. */
function frontmatterIssues(frontmatter: unknown): ValidationIssue[] {
  if (!isPlainObject(frontmatter)) {
    return [{ path: 'frontmatter', message: 'Input should be a valid dictionary' }];
  }
  const fm = frontmatter;
  const issues: ValidationIssue[] = [];
  const add = (key: string, message: string | null) => {
    if (message) issues.push({ path: `frontmatter.${key}`, message });
  };
  const nameIssue = stringField(fm, 'name', { required: true });
  add('name', nameIssue ?? nameProblem(fm.name as string));
  add('description', stringField(fm, 'description', { required: true, min: 1, max: 1024 }));
  add('license', stringField(fm, 'license', {}));
  add('compatibility', stringField(fm, 'compatibility', { max: 500 }));
  add('allowed-tools', stringField(fm, 'allowed-tools', {}));
  if ('metadata' in fm && fm.metadata !== null) {
    if (!isPlainObject(fm.metadata)) {
      add('metadata', 'Input should be a valid dictionary');
    } else {
      for (const [key, value] of Object.entries(fm.metadata)) {
        if (typeof value !== 'string') add(`metadata.${key}`, 'Input should be a valid string');
      }
    }
  }
  for (const [key, value] of Object.entries(fm)) {
    if ((KEY_ORDER as readonly string[]).includes(key)) continue;
    const flat = Array.isArray(value)
      ? value.every(isScalar)
      : isPlainObject(value)
        ? Object.values(value).every(isScalar)
        : isScalar(value);
    if (!flat) add(key, 'must be a scalar, or a flat list or map of scalars');
  }
  return issues;
}

/** The strict check: size caps, frontmatter schema, name rules, and every path. */
export function validateSkillBundle(files: SkillBundle, expectedSlug?: string): ValidationResult {
  const skillMd = files['SKILL.md'];
  if (!skillMd) {
    return { valid: false, errors: [{ path: 'SKILL.md', message: 'SKILL.md is required' }] };
  }
  const oversized = sizeIssues(files, skillMd);
  if (oversized.length > 0) return { valid: false, errors: oversized };

  const parsed = parseSkillMd(skillMd);
  if (!parsed) {
    return {
      valid: false,
      errors: [
        {
          path: 'SKILL.md',
          message:
            'SKILL.md must contain YAML frontmatter delimited by --- ' +
            '(within the size and nesting limits, with no anchors or aliases)',
        },
      ],
    };
  }
  const errors = frontmatterIssues(parsed.frontmatter);
  const raw = isPlainObject(parsed.frontmatter) ? parsed.frontmatter : {};
  if (expectedSlug && raw.name !== expectedSlug) {
    errors.push({
      path: 'frontmatter.name',
      message: `name must match skill slug "${expectedSlug}"`,
    });
  }
  for (const [path, content] of Object.entries(files)) {
    if (path !== 'SKILL.md') errors.push(...fileIssues(path, content));
  }
  if (errors.length > 0) return { valid: false, errors };
  return {
    valid: true,
    frontmatter: parsed.frontmatter as SkillFrontmatter,
    body: parsed.body,
    errors: [],
  };
}

/**
 * A minimal valid bundle. Serialised, not interpolated: a description holding
 * `: ` would otherwise produce frontmatter that fails its own validation.
 */
export function createSkillTemplate(slug: string, description: string): SkillBundle {
  const body = `\n# ${slug}\n\nAdd skill instructions here.\n`;
  return { 'SKILL.md': serializeSkillMd({ name: slug, description }, body) };
}

/** `{name, description}` of a valid bundle, else null. */
export function extractDiscoveryMeta(
  files: SkillBundle,
): { name: string; description: string } | null {
  const result = validateSkillBundle(files);
  if (!result.valid) return null;
  return { name: result.frontmatter.name, description: result.frontmatter.description };
}
