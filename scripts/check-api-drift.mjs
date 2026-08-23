#!/usr/bin/env node
/**
 * Fail CI when a browser client calls a route the harness does not serve.
 *
 * The wire contract is hand-mirrored: each app keeps its own `api.ts`, and the
 * harness (felix-run/felix) moves independently. Nothing else notices when a
 * route is renamed or dropped — the surface just returns an error banner that a
 * user has to click into to find.
 *
 * Usage:
 *   node scripts/check-api-drift.mjs <openapi.json> <api.ts...>
 *   node scripts/check-api-drift.mjs --self-test
 *
 * Refresh the snapshot against a running harness:
 *   curl -s "$FELIX_ORIGIN/openapi.json" \
 *     | jq '{openapi, info: {title: .info.title, version: .info.version},
 *            paths: .paths | map_values(map_values({}))}' \
 *     > apps/chat-ui/harness-openapi.json
 */
import { readFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

/** Wrappers in api.ts that prepend a fixed prefix to their path argument. */
const HELPERS = {
  apiFetch: '',
  manifestFetch: '/manifests',
  evalFetch: '/eval',
  jobsFetch: '/jobs',
};

const VERBS = ['get', 'post', 'put', 'delete', 'patch'];

/** `/chat/runs/${encodeURIComponent(t)}?x=1` -> `/chat/runs/{}` */
function normalise(p) {
  return (
    p
      .replace(/\$\{[^}]*\}/g, '{}') // template vars -> {}
      .replace(/\?.*$/, '') // drop query string
      .replace(/(\{\})+/g, '{}') // adjacent vars are one segment
      .replace(/\/+$/, '') || '/'
  );
}

/** Extract every `{ method, path }` a client source calls. */
export function extractCalls(src, file = '<src>') {
  const calls = [];
  for (const [fn, prefix] of Object.entries(HELPERS)) {
    const re = new RegExp(`\\b${fn}\\s*(?:<[^>()]*>)?\\s*\\(\\s*(['"\`])([^'"\`]*)\\1`, 'g');
    for (const m of src.matchAll(re)) {
      let path = m[2];
      // The helper *definitions* forward `${path}` — not a call site.
      if (/^\/api\/(manifests|eval|jobs)?\$\{path\}$/.test(path)) continue;
      if (fn === 'apiFetch') {
        if (!path.startsWith('/api')) continue;
        path = path.slice('/api'.length);
      }
      // The verb lives in the init object just after the path argument.
      const verb = src.slice(m.index, m.index + 300).match(/method:\s*'([A-Z]+)'/);
      calls.push({
        file,
        line: src.slice(0, m.index).split('\n').length,
        path: normalise(prefix + path),
        method: verb ? verb[1] : 'GET',
      });
    }
  }
  return calls;
}

/** path template -> the set of methods the harness serves there. */
function loadSpec(specPath) {
  const spec = new Map();
  for (const [p, ops] of Object.entries(JSON.parse(readFileSync(specPath, 'utf8')).paths)) {
    const key = normalise(p).replace(/\{[^}]*\}/g, '{}');
    const methods = Object.keys(ops)
      .filter((m) => VERBS.includes(m))
      .map((m) => m.toUpperCase());
    spec.set(key, new Set([...(spec.get(key) ?? []), ...methods]));
  }
  return spec;
}

function diff(calls, spec) {
  const bad = [];
  for (const c of calls) {
    const methods = spec.get(c.path);
    if (!methods) bad.push({ ...c, why: 'no such path' });
    else if (!methods.has(c.method))
      bad.push({ ...c, why: `serves ${[...methods].sort().join('/')}, not ${c.method}` });
  }
  return [...new Map(bad.map((c) => [`${c.file}:${c.method} ${c.path}`, c])).values()];
}

/**
 * Guard the guard. The extractor is regex over source, so a refactor of how
 * api.ts spells its calls could silently reduce it to finding nothing — which
 * would read as "no drift" forever. Assert it still catches known-bad calls.
 */
function selfTest() {
  const sample = `
    async function manifestFetch<T>(path: string) { return apiFetch(\`/api/manifests\${path}\`); }
    export async function a() { return apiFetch('/api/jobs/list'); }
    export async function b(name: string) {
      return manifestFetch(\`/\${encodeURIComponent(name)}\`, { method: 'POST' });
    }
    export async function c() { return apiFetch('/api/health'); }
  `;
  const spec = new Map([
    ['/jobs', new Set(['GET'])],
    ['/manifests/{}', new Set(['GET', 'PUT'])],
    ['/health', new Set(['GET'])],
  ]);
  const calls = extractCalls(sample);
  const bad = diff(calls, spec);
  const problems = [];
  if (calls.length !== 3) problems.push(`expected 3 call sites, extracted ${calls.length}`);
  if (!bad.some((b) => b.path === '/jobs/list')) problems.push('missed a dead path');
  if (!bad.some((b) => b.path === '/manifests/{}' && b.method === 'POST'))
    problems.push('missed a wrong verb');
  if (bad.some((b) => b.path === '/health')) problems.push('false positive on a valid call');

  if (problems.length) {
    console.error('✗ self-test failed — the extractor is broken:\n');
    for (const p of problems) console.error(`  ${p}`);
    exit(1);
  }
  console.log('✓ self-test passed (extractor detects dead paths and wrong verbs)');
}

const [, , specPath, ...sources] = argv;

if (specPath === '--self-test') {
  selfTest();
  exit(0);
}
if (!specPath || !sources.length) {
  console.error('usage: check-api-drift.mjs <openapi.json> <api.ts...>  |  --self-test');
  exit(2);
}

selfTest();

const spec = loadSpec(specPath);
const calls = sources.flatMap((f) => extractCalls(readFileSync(f, 'utf8'), f));
const missing = diff(calls, spec);

console.log(`checked ${calls.length} client call sites against ${spec.size} harness paths`);
if (!missing.length) {
  console.log('✓ no drift');
  exit(0);
}
console.error(`\n✗ ${missing.length} call(s) the harness does not serve:\n`);
for (const m of missing) {
  console.error(`  ${m.method} ${m.path}  — ${m.why}\n      ${m.file}:${m.line}`);
}
console.error('\nEither the harness changed, or the client calls a route that never existed.');
exit(1);
