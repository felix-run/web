#!/usr/bin/env node
/**
 * Fail CI when a stylesheet stops covering a source that ships Tailwind classes.
 *
 * Tailwind v4 generates a rule only for a class it has *seen*. It scans the app
 * root automatically and nothing else — not a workspace package outside that
 * root, and not a dependency that styles itself with Tailwind classes baked into
 * its own `dist`. Each of those needs an `@source` line in `index.css`, and the
 * failure when one is missing is the worst kind: the class stays on the element,
 * no rule is generated, no build step complains, and the component renders
 * unstyled with no error anywhere.
 *
 * It is also *partial*, which is why it survives review. A class the app happens
 * to use elsewhere works, so most of the page looks right. On 2026-08-25 the
 * missing source was `streamdown`, which renders every assistant message: its
 * `bg-muted/80` worked and its `dark:text-(--shiki-dark)!` did not, so markdown
 * lists lost their markers and code blocks lost their entire dark theme while
 * everything around them looked fine.
 *
 * The check compiles the app's stylesheet twice — once as it is, once with only
 * Tailwind's automatic detection — and asserts that each guarded source's canary
 * classes appear in the first and not the second. Present in both would mean the
 * canary proves nothing; absent from both means the source is no longer covered.
 * Compiling is the only honest test, because the question is what Tailwind
 * actually scanned, not what a config file says it should have.
 *
 * Usage:
 *   node scripts/check-tailwind-sources.mjs [<stylesheet>]
 *   node scripts/check-tailwind-sources.mjs --self-test
 *
 * Adding a package or dependency that ships classes means adding a GUARDED
 * entry. An `@source` line with no entry fails: an uncovered canary is how this
 * check knows the line is load-bearing rather than decorative.
 */
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { argv, cwd, exit } from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_STYLESHEET = 'apps/chat-ui/src/index.css';

/**
 * Every source outside the app root that ships Tailwind classes.
 *
 * `canaries` are classes that source emits and that Tailwind cannot find any
 * other way — the second half is measured by the baseline compile, not assumed,
 * because a canary reachable without the `@source` line would keep passing after
 * the line was deleted. Pick a new one by grepping the source for a class the app
 * has no reason to spell.
 */
export const GUARDED = [
  {
    label: '@felix/ui',
    path: 'packages/ui/src',
    // Consumed as raw .tsx from outside the app root, so nothing in the app's
    // own tree mentions the utilities that live inside a primitive.
    canaries: ['bg-primary', 'hover:bg-primary/90'],
  },
  {
    label: 'streamdown',
    path: 'apps/chat-ui/node_modules/streamdown/dist',
    // Renders every assistant message. Both canaries are pure Streamdown: the
    // first carries Shiki's dark palette onto highlighted tokens, the second
    // draws the line-number gutter.
    canaries: ['dark:text-(--shiki-dark)!', 'before:content-[counter(line)]'],
  },
];

/**
 * The `@source` paths a stylesheet declares, resolved against its own directory
 * (which is what Tailwind resolves them against).
 *
 * A glob is truncated at its first wildcard, because this only ever asks which
 * directory a line reaches — `dist/*.js` and `dist` cover the same tree for that
 * question.
 *
 * `@source not` is recorded and kept apart: it *removes* a tree from the scan, so
 * counting one as coverage would read an exclusion as proof the classes are there.
 */
export function parseSources(css, cssDir) {
  const out = [];
  for (const m of css.matchAll(/@source\s+(not\s+)?["']([^"']+)["']/g)) {
    const raw = m[2];
    const stem = raw.split(/[*?{[]/)[0];
    out.push({
      raw,
      negated: Boolean(m[1]),
      resolved: resolve(cssDir, stem).replace(/\/$/, ''),
    });
  }
  return out;
}

/** Whether an `@source` line reaches a guarded path. */
export function covers(sourcePath, guardedPath) {
  return guardedPath === sourcePath || guardedPath.startsWith(`${sourcePath}/`);
}

/**
 * A class as Tailwind writes it into a selector.
 *
 * Everything outside `[A-Za-z0-9_-]` is backslash-escaped, so `hover:bg-primary/90`
 * becomes `.hover\:bg-primary\/90` — a prefix of the real selector, which also
 * carries variant suffixes like `:hover` or `:is(.dark *)`.
 */
export function escapeClass(cls) {
  return `.${cls.replace(/[^A-Za-z0-9_-]/g, (ch) => `\\${ch}`)}`;
}

/**
 * Class-like tokens in a file, split on whitespace and quotes.
 *
 * Exact tokens rather than substrings: `bg-primary` must not be found inside
 * `bg-primary/90`, or a canary would look present in a tree that never uses it.
 */
export function classTokens(text) {
  return new Set(text.split(/[\s"'`\\]+/).filter(Boolean));
}

const SCANNABLE = /\.(?:tsx?|jsx?|cjs|mjs|css|html)$/;

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry.startsWith('.')) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, files);
    else if (SCANNABLE.test(entry)) files.push(p);
  }
  return files;
}

/** Every class-like token in a tree. */
export function tokensIn(dir) {
  const all = new Set();
  for (const file of walk(dir)) {
    for (const t of classTokens(readFileSync(file, 'utf8'))) all.add(t);
  }
  return all;
}

/**
 * Compile a stylesheet through the app's real pipeline and return the CSS.
 *
 * The same Vite plugin the app builds with, so `@source` resolution, the ignore
 * rules that keep `node_modules` out of automatic detection, and the scanner are
 * all the production ones. In memory and unminified; ~120ms.
 *
 * `overrideCss` compiles alternative content from the stylesheet's own directory,
 * so every relative `@source` and `@import` in it resolves exactly as the real
 * file's would.
 */
export async function compile(appDir, cssPath, overrideCss) {
  const req = createRequire(join(appDir, 'package.json'));
  const tailwindcss = (await import(pathToFileURL(req.resolve('@tailwindcss/vite')).href)).default;
  const { build } = await import(pathToFileURL(req.resolve('vite')).href);

  const tmp = join(dirname(cssPath), '.check-tailwind-sources.tmp.css');
  const input = overrideCss === undefined ? cssPath : tmp;
  if (overrideCss !== undefined) writeFileSync(tmp, overrideCss);

  try {
    const result = await build({
      root: appDir,
      configFile: false,
      logLevel: 'error',
      plugins: [tailwindcss()],
      build: { write: false, cssMinify: false, rollupOptions: { input } },
    });
    const outputs = Array.isArray(result) ? result[0].output : result.output;
    const css = outputs.find((o) => o.fileName.endsWith('.css'));
    return String(css?.source ?? '');
  } finally {
    if (overrideCss !== undefined) rmSync(tmp, { force: true });
  }
}

/**
 * The directives a stylesheet needs to compile at all, minus every `@source`.
 *
 * The baseline the guarded sources are measured against: whatever Tailwind finds
 * on its own from the app root. `@custom-variant` comes along because a canary
 * carrying the `dark:` variant cannot generate a rule without it, and a canary
 * that fails to compile for the wrong reason would read as a pass.
 */
export function baselineCss(css) {
  return css
    .split('\n')
    .filter((line) => /^\s*@(?:import|custom-variant)\b/.test(line))
    .join('\n');
}

function selfTest() {
  const problems = [];
  const eq = (actual, expected, what) => {
    if (actual !== expected) problems.push(`${what}: expected ${expected}, got ${actual}`);
  };

  eq(escapeClass('bg-primary'), '.bg-primary', 'plain class');
  eq(escapeClass('hover:bg-primary/90'), '.hover\\:bg-primary\\/90', 'variant + modifier');
  eq(
    escapeClass('dark:text-(--shiki-dark)!'),
    '.dark\\:text-\\(--shiki-dark\\)\\!',
    'arbitrary value + important',
  );
  eq(
    escapeClass('before:content-[counter(line)]'),
    '.before\\:content-\\[counter\\(line\\)\\]',
    'bracketed value',
  );

  const sources = parseSources(
    `@source "../../../packages/ui/src";\n@source "../node_modules/streamdown/dist";\n` +
      `@source "./sub/*.js";\n@source not "../ignored";\n`,
    '/repo/apps/app/src',
  );
  eq(sources.length, 4, 'source count');
  eq(sources[0].resolved, '/repo/packages/ui/src', 'relative source');
  eq(sources[2].resolved, '/repo/apps/app/src/sub', 'glob truncated to its directory');
  eq(sources[0].negated, false, 'plain source should not read as negated');
  eq(sources[3].negated, true, '`@source not` should be recorded as negated');
  eq(sources[3].resolved, '/repo/apps/app/ignored', 'negated source path');

  const streamdown = '/repo/apps/app/node_modules/streamdown/dist';
  if (!covers('/repo/apps/app/node_modules/streamdown/dist', streamdown)) {
    problems.push('covers: exact path should match');
  }
  if (!covers('/repo/apps/app/node_modules/streamdown', streamdown)) {
    problems.push('covers: parent directory should match');
  }
  if (covers('/repo/apps/app/node_modules/streamdown-other', streamdown)) {
    problems.push('covers: sibling with a shared prefix should not match');
  }

  const tokens = classTokens('className="dark:bg-(--shiki-dark-bg)! dark:text-(--shiki-dark)!"');
  if (!tokens.has('dark:text-(--shiki-dark)!')) problems.push('classTokens: missed a real token');
  if (tokens.has('dark:bg-(--shiki-dark-bg)')) {
    problems.push('classTokens: split a token at its own punctuation');
  }
  if (classTokens('class="bg-primary/90"').has('bg-primary')) {
    problems.push('classTokens: matched a prefix of a longer class');
  }

  const base = baselineCss(
    '@import "tailwindcss";\n@source "../x";\n@custom-variant dark (&:is(.dark *));\n.a{}',
  );
  if (base.includes('@source')) problems.push('baselineCss: kept an @source line');
  if (!base.includes('@import') || !base.includes('@custom-variant')) {
    problems.push('baselineCss: dropped a directive the canaries need');
  }

  if (problems.length) {
    console.error('✗ self-test failed — the helpers are broken:\n');
    for (const p of problems) console.error(`  ${p}`);
    exit(1);
  }
  console.log('✓ self-test passed (escaping, source parsing, coverage, tokenising)');
}

const args = argv.slice(2);
if (args[0] === '--self-test') {
  selfTest();
  exit(0);
}

const cssPath = resolve(REPO, args[0] ?? DEFAULT_STYLESHEET);
if (!existsSync(cssPath)) {
  console.error(`✗ no stylesheet at ${relative(cwd(), cssPath)}`);
  exit(1);
}
const appDir = resolve(dirname(cssPath), '..');
const css = readFileSync(cssPath, 'utf8');
const sources = parseSources(css, dirname(cssPath));
const show = (p) => (isAbsolute(p) ? relative(REPO, p) : p);

const failures = [];

// A source with no entry here has no canary, so nothing would notice if the line
// were deleted. Only lines reaching outside the app root need one — the app's own
// tree is scanned automatically.
for (const source of sources) {
  if (source.negated) continue;
  if (source.resolved.startsWith(`${appDir}/`) && !source.resolved.includes('/node_modules/')) {
    continue;
  }
  if (!GUARDED.some((g) => covers(source.resolved, resolve(REPO, g.path)))) {
    failures.push(
      `@source "${source.raw}" has no GUARDED entry — add one with a canary class, ` +
        'or this line can be deleted without anything failing.',
    );
  }
}

for (const guarded of GUARDED) {
  const path = resolve(REPO, guarded.path);
  if (!existsSync(path)) {
    failures.push(`${guarded.label}: ${show(path)} does not exist — the entry is stale.`);
    continue;
  }
  if (!sources.some((s) => !s.negated && covers(s.resolved, path))) {
    failures.push(
      `${guarded.label}: no @source in ${show(cssPath)} reaches ${show(path)}. ` +
        'Every class that lives only there is silently dropped from the build.',
    );
  }
  const own = tokensIn(path);
  for (const canary of guarded.canaries) {
    if (!own.has(canary)) {
      failures.push(
        `${guarded.label}: canary \`${canary}\` no longer appears in ${show(path)} — ` +
          'it was probably renamed upstream. Pick a current class from that source.',
      );
    }
  }
}

// Nothing below can be trusted if the wiring above is wrong: a canary missing
// from a tree, or an @source pointing nowhere, makes the compile meaningless.
if (failures.length) {
  console.error(`✗ ${failures.length} problem(s) with the Tailwind source wiring:\n`);
  for (const f of failures) console.error(`  ${f}\n`);
  exit(1);
}

const [full, baseline] = await Promise.all([
  compile(appDir, cssPath),
  compile(appDir, cssPath, baselineCss(css)),
]);

const canaries = GUARDED.flatMap((g) => g.canaries.map((canary) => ({ label: g.label, canary })));
const missing = [];
const unattributed = [];

for (const { label, canary } of canaries) {
  const selector = escapeClass(canary);
  if (!full.includes(selector)) missing.push({ label, canary });
  else if (baseline.includes(selector)) unattributed.push({ label, canary });
}

console.log(
  `compiled ${show(cssPath)} (${Math.round(full.length / 1024)} kB) against ` +
    `${GUARDED.length} guarded source(s), ${canaries.length} canaries`,
);

if (missing.length) {
  console.error(`\n✗ ${missing.length} canary class(es) generated no rule:\n`);
  for (const m of missing) console.error(`  ${m.label}  ${m.canary}`);
  console.error(
    '\nTailwind never saw these. The class stays on the element, no CSS is\n' +
      'generated, and the component renders unstyled with no error anywhere —\n' +
      'check the @source lines in the stylesheet.',
  );
  exit(1);
}

if (unattributed.length) {
  console.error(`\n✗ ${unattributed.length} canary compiled without its @source line:\n`);
  for (const u of unattributed) console.error(`  ${u.label}  ${u.canary}`);
  console.error(
    '\nTailwind finds these on its own, so they would keep compiling after the\n' +
      'line was deleted. They prove nothing — pick canaries that only that\n' +
      'source emits.',
  );
  exit(1);
}

console.log('✓ every guarded source reaches the build');
exit(0);
