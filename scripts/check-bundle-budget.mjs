#!/usr/bin/env node
/**
 * Fail CI when chat-ui's first load grows past its budget.
 *
 * What a browser fetches before it can draw anything is `dist/index.html`'s own list: the
 * entry script, every `modulepreload`, and the stylesheet. It was ~504 kB gzipped until
 * KaTeX and `rehype-raw` (with parse5) were moved out of it (`src/lib/reply-plugins.ts`),
 * and both left the same way they came in — one static import, at the top of a
 * dependency's bundle, that type-checks, lints and renders exactly as before. Nothing
 * else in CI would notice either coming back, or the next one arriving.
 *
 * Sizes are gzip at level 9, which is close to what the edge sends and stable from run
 * to run. The budget sits a little above the current size so an ordinary change passes;
 * raise it on purpose, in the same PR as the code that needs it, saying why.
 *
 * Usage (after `pnpm build`):
 *   node scripts/check-bundle-budget.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { exit } from 'node:process';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

/** Gzipped kB the first load may weigh. Measured 433 kB on 2026-10-22. */
const BUDGET_KB = 450;

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(REPO, 'apps/chat-ui/dist');
const html = join(DIST, 'index.html');

if (!existsSync(html)) {
  console.error(`✗ ${html} not found — run \`pnpm --filter @felix/chat-ui build\` first.`);
  exit(2);
}

// The entry `<script src>`, each `<link rel="modulepreload">` and the stylesheet — whatever
// order the attributes come in. Icons and the manifest are links too, and are not this.
const eager = [];
for (const [tag] of readFileSync(html, 'utf8').matchAll(/<(?:script|link)\b[^>]*>/g)) {
  if (tag.startsWith('<link') && !/rel="(?:modulepreload|stylesheet)"/.test(tag)) continue;
  const file = tag.match(/(?:src|href)="\/([^"]+\.(?:js|css))"/)?.[1];
  if (file && !eager.includes(file)) eager.push(file);
}

if (eager.length === 0) {
  console.error('✗ found no script or preload in index.html — the pattern above is out of date.');
  exit(2);
}

const sizes = eager
  .map((file) => {
    const bytes = readFileSync(join(DIST, file));
    return { file, raw: bytes.length, gz: gzipSync(bytes, { level: 9 }).length };
  })
  .sort((a, b) => b.gz - a.gz);
const total = sizes.reduce((sum, s) => sum + s.gz, 0) / 1024;
const kb = (n) => `${(n / 1024).toFixed(1)} kB`;

if (total > BUDGET_KB) {
  console.error(
    `✗ chat-ui's first load is ${total.toFixed(1)} kB gzipped, over its ${BUDGET_KB} kB budget.`,
  );
  console.error('  Largest of the files index.html loads up front:');
  for (const s of sizes.slice(0, 8)) console.error(`    ${kb(s.gz).padStart(9)}  ${s.file}`);
  console.error(
    '  Find what arrived with `vite build --sourcemap` and move it behind a dynamic import,\n' +
      '  as KaTeX and rehype-raw are (apps/chat-ui/vite.config.ts, src/lib/reply-plugins.ts).\n' +
      '  Raise BUDGET_KB only on purpose, in the PR that needs it.',
  );
  exit(1);
}
console.log(
  `✓ first load ${total.toFixed(1)} kB gzipped across ${sizes.length} files (budget ${BUDGET_KB} kB)`,
);
