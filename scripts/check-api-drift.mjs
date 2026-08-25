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
 * Refresh the snapshot from a harness *checkout*:
 *   node scripts/sync-harness-contract.mjs [path-to-felix-checkout]
 *
 * Not by curling a running harness. That records the deployment rather than the
 * contract, and the two diverge exactly when it matters: on 2026-08-24 the
 * container on :8080 was two features behind the checkout, so the snapshot
 * omitted `/memory/*` and `GET /chat/stream/{thread_id}` — and this check stayed
 * green while the client could not have called either.
 *
 * The script also reports the reverse direction, which this one cannot fail on:
 * routes the harness serves that nothing here calls.
 */
import { readFileSync } from 'node:fs';
import { argv, exit } from 'node:process';

/**
 * Call spellings in api.ts, mapped to the prefix each prepends.
 *
 * `fetch` is here because three call sites deliberately bypass `apiFetch` — a
 * 401 from them means "no server history", not "the key is wrong", and going
 * through the wrapper would trip the shared-key reset and reload the page. They
 * were invisible to this check, so the harness could have renamed
 * `/chat/history/{thread_id}` and nothing would have failed.
 *
 * `apiFetch` and `fetch` take a full `/api/...` path and have that prefix
 * stripped; the rest prepend their own. Matching is case-sensitive, which is
 * what keeps `\bfetch` from also matching `apiFetch` and `manifestFetch`.
 */
const HELPERS = {
  apiFetch: '',
  fetch: '',
  manifestFetch: '/manifests',
  evalFetch: '/eval',
  jobsFetch: '/jobs',
};

/** Helpers whose argument is a full `/api/...` path rather than a suffix. */
const API_PREFIXED = new Set(['apiFetch', 'fetch']);

const VERBS = ['get', 'post', 'put', 'delete', 'patch'];

/**
 * Collapse every `${…}` to `{}`, counting braces rather than matching a regex.
 *
 * `/api/chat/history/${encodeURIComponent(id)}${qs ? `?${qs}` : ''}` is a real
 * call site, and a non-greedy `\$\{[^}]*\}` stops at the `}` of the *inner*
 * `${qs}` — leaving a mangled path that reads as drift against a route that is
 * fine. Nested templates are ordinary in a query-string builder, so the scanner
 * has to survive them.
 */
export function collapseExpressions(raw) {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '$' && raw[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < raw.length && depth > 0) {
        if (raw[i] === '{') depth++;
        else if (raw[i] === '}') depth--;
        i++;
      }
      i--; // the for-loop increment consumes the closing brace
      out += '{}';
    } else {
      out += raw[i];
    }
  }
  return out;
}

/**
 * Read the string literal starting at `src[i]`, returning its raw body.
 *
 * Backticks need real scanning: a nested template inside `${…}` contains its own
 * backticks, and `indexOf` would stop at the first of them.
 */
export function readStringLiteral(src, i) {
  const quote = src[i];
  if (quote !== '`') {
    const end = src.indexOf(quote, i + 1);
    return end === -1 ? null : { raw: src.slice(i + 1, end), end };
  }
  let j = i + 1;
  let depth = 0;
  while (j < src.length) {
    const c = src[j];
    if (c === '\\') {
      j += 2;
      continue;
    }
    if (depth === 0 && c === '`') return { raw: src.slice(i + 1, j), end: j };
    if (c === '$' && src[j + 1] === '{') {
      depth++;
      j += 2;
      continue;
    }
    if (depth > 0) {
      if (c === '{') depth++;
      else if (c === '}') depth--;
      else if (c === '`') {
        const inner = readStringLiteral(src, j);
        if (!inner) return null;
        j = inner.end + 1;
        continue;
      }
    }
    j++;
  }
  return null;
}

/**
 * The source of one call's arguments: from its `(` to the matching `)`.
 *
 * The verb lives in the init object, and it used to be looked for in a fixed
 * window of characters after the path. That window does not know where the call
 * ends: for `jobsFetch(\`/${name}/runs\`)`, which passes no init at all, it ran
 * on into the *next* function and found its `method: 'DELETE'` — reporting drift
 * on a GET route that was never called with DELETE. Balancing parens bounds it
 * to the call that actually owns the verb.
 */
export function readCallArgs(src, parenIdx) {
  let depth = 0;
  let i = parenIdx;
  while (i < src.length) {
    const c = src[i];
    if (c === "'" || c === '"' || c === '`') {
      const lit = readStringLiteral(src, i);
      if (!lit) break;
      i = lit.end + 1;
      continue;
    }
    if (c === '(') depth++;
    else if (c === ')') {
      depth--;
      if (depth === 0) return src.slice(parenIdx + 1, i);
    }
    i++;
  }
  return src.slice(parenIdx + 1, Math.min(src.length, parenIdx + 300));
}

/** `/chat/runs/${encodeURIComponent(t)}?x=1` -> `/chat/runs/{}` */
function normalise(p) {
  return (
    collapseExpressions(p)
      .replace(/\?.*$/, '') // drop query string
      .replace(/(\{\})+/g, '{}') // adjacent vars are one segment
      .replace(/\/+$/, '') || '/'
  );
}

/** Extract every `{ method, path }` a client source calls. */
export function extractCalls(src, file = '<src>') {
  const calls = [];
  for (const [fn, prefix] of Object.entries(HELPERS)) {
    // Match up to the opening quote only; the literal itself is scanned, because
    // a template can nest another one and a character class cannot see that.
    const re = new RegExp(`\\b${fn}\\s*(?:<[^>()]*>)?\\s*\\(\\s*(?=['"\`])`, 'g');
    for (const m of src.matchAll(re)) {
      const quoteAt = m.index + m[0].length;
      const parenAt = m.index + m[0].lastIndexOf('(');
      const literal = readStringLiteral(src, quoteAt);
      if (!literal) continue;
      let path = literal.raw;
      // The helper *definitions* forward `${path}` — not a call site.
      if (/^\/api\/(manifests|eval|jobs)?\$\{path\}$/.test(path)) continue;
      if (API_PREFIXED.has(fn)) {
        // A bare `fetch` to anything else (an absolute URL, a static asset) is
        // not part of this contract.
        if (!path.startsWith('/api')) continue;
        path = path.slice('/api'.length);
      }
      // The verb lives in the init object just after the path argument.
      const verb = readCallArgs(src, parenAt).match(/method:\s*'([A-Z]+)'/);
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

/**
 * Routes the harness serves that nothing calls.
 *
 * Advisory, never a failure: most of these are deliberate. `/mcp`, `/a2a` and
 * `/v1/chat/completions` are machine-facing and no UI is expected, and a route
 * can be perfectly reasonable to leave alone. But this direction is where the
 * *interesting* gaps live — a whole feature the harness grew and the client
 * never learned to ask for — and finding them previously meant inverting this
 * script by hand.
 */
function uncovered(calls, spec) {
  const called = new Set(calls.map((c) => `${c.method} ${c.path}`));
  const out = [];
  for (const [path, methods] of spec) {
    for (const m of methods) {
      if (!called.has(`${m} ${path}`)) out.push(`${m} ${path}`);
    }
  }
  return out.sort();
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
    // Bypasses apiFetch on purpose, and is still part of the contract.
    export async function d(id: string, qs: string) {
      return fetch(\`/api/chat/history/\${encodeURIComponent(id)}\${qs ? \`?\${qs}\` : ''}\`);
    }
    // No init object: the verb search must not run on past this call.
    export async function e() { return apiFetch('/api/plans'); }
    export async function f() { return apiFetch('/api/usage', { method: 'DELETE' }); }
    // Not part of the /api contract.
    export async function g() { return fetch('https://example.com/thing'); }
  `;
  const spec = new Map([
    ['/jobs', new Set(['GET'])],
    ['/manifests/{}', new Set(['GET', 'PUT'])],
    ['/health', new Set(['GET'])],
    ['/chat/history/{}', new Set(['GET'])],
    ['/plans', new Set(['GET'])],
    ['/usage', new Set(['GET'])],
  ]);
  const calls = extractCalls(sample);
  const bad = diff(calls, spec);
  const problems = [];
  if (calls.length !== 6) problems.push(`expected 6 call sites, extracted ${calls.length}`);
  if (!bad.some((b) => b.path === '/jobs/list')) problems.push('missed a dead path');
  if (!bad.some((b) => b.path === '/manifests/{}' && b.method === 'POST'))
    problems.push('missed a wrong verb');
  if (bad.some((b) => b.path === '/health')) problems.push('false positive on a valid call');

  // A bare `fetch` is in the contract; an absolute URL is not.
  if (!calls.some((c) => c.path === '/chat/history/{}')) {
    problems.push('missed a bare fetch call site');
  }
  if (calls.some((c) => c.path.includes('example.com'))) {
    problems.push('counted a non-/api fetch');
  }
  // Nested template: a naive `\${[^}]*}` mangles this into a phantom path.
  if (bad.some((b) => b.path.includes('$') || b.path.includes('`'))) {
    problems.push('failed to collapse a nested template expression');
  }
  // The verb search must stop at the end of its own call.
  if (bad.some((b) => b.path === '/plans')) {
    problems.push("read a later call's method: into a call that passes none");
  }
  if (!bad.some((b) => b.path === '/usage' && b.method === 'DELETE')) {
    problems.push('lost the verb on a call that does pass one');
  }

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

const unused = uncovered(calls, spec);
if (unused.length) {
  // stdout, not stderr: this is information, not a problem.
  console.log(`\n  ${unused.length} route(s) the harness serves and no client calls:`);
  for (const u of unused) console.log(`    ${u}`);
  console.log('  (advisory — machine-facing surfaces belong here, and so does anything unbuilt)');
}

if (!missing.length) {
  console.log('\n✓ no drift');
  exit(0);
}
console.error(`\n✗ ${missing.length} call(s) the harness does not serve:\n`);
for (const m of missing) {
  console.error(`  ${m.method} ${m.path}  — ${m.why}\n      ${m.file}:${m.line}`);
}
console.error('\nEither the harness changed, or the client calls a route that never existed.');
exit(1);
