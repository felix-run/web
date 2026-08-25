#!/usr/bin/env node
/**
 * Re-record what the harness serves, from a harness *checkout*.
 *
 * Two files describe the hand-mirrored contract, and both were maintained by
 * hand against whatever happened to be running:
 *
 *   apps/chat-ui/harness-openapi.json  — every route, for check-api-drift
 *   scripts/harness-events.json        — every SSE event, for check-protocol-parity
 *
 * The old instructions said to `curl $FELIX_ORIGIN/openapi.json`. That records
 * the *deployment*, not the contract, and the two diverge exactly when it
 * matters: on 2026-08-24 the container on :8080 was two features behind the
 * checkout, so the snapshot omitted `/memory/*` and `GET /chat/stream/{id}`
 * entirely — and check-api-drift stayed green while the client could not have
 * called either. FastAPI will build the spec without a database, so there is no
 * reason to ask a running process.
 *
 * Usage:
 *   node scripts/sync-harness-contract.mjs [path-to-felix-checkout]
 *   node scripts/sync-harness-contract.mjs --self-test
 *
 * Defaults to ~/Projects/felix. Review the diff before committing: this reports
 * what the harness does, and a surprise in that diff is the signal.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OPENAPI_OUT = join(REPO, 'apps/chat-ui/harness-openapi.json');
const EVENTS_OUT = join(REPO, 'scripts/harness-events.json');

/**
 * Names that reach a browser as an SSE envelope `{event, …}` but are not worth
 * a client arm, because nothing renders them.
 */
const IGNORED = new Set(['prompt_result']);

/**
 * SSE `event:`-typed frames, and the union arm the reader folds each into.
 *
 * `error` is the only one. It does not arrive in the usual envelope — its body
 * is `{error: {message, type}}` — so `readSseStream` normalises it, and the arm
 * to look for is the normalised name rather than the wire name.
 */
const NORMALISED = { error: 'on_error' };

/** Every `.py` under a directory, skipping vendored and test trees. */
function pythonFiles(root) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === '.venv' || name === 'node_modules' || name === 'tests' || name[0] === '.') {
        continue;
      }
      const full = join(dir, name);
      const st = statSync(full);
      if (st.isDirectory()) walk(full);
      else if (name.endsWith('.py')) out.push(full);
    }
  };
  walk(root);
  return out;
}

/**
 * Every SSE event name the harness can emit.
 *
 * Three spellings produce one, and all three are in live use:
 *   Event(event="text_delta")            — the agent loop
 *   {"event": "run_status", "data": …}   — routes building a frame by hand
 *   emit_side_event(thread_id, "ui_request", …)  — out-of-band interrupts
 */
export function extractEvents(sources) {
  const found = new Set();
  for (const src of sources) {
    for (const m of src.matchAll(/\bevent\s*=\s*["']([a-z0-9_]+)["']/g)) found.add(m[1]);
    for (const m of src.matchAll(/["']event["']\s*:\s*["']([a-z0-9_]+)["']/g)) found.add(m[1]);
    // The name is the second argument and often wraps onto its own line.
    for (const m of src.matchAll(/emit_side_event\(\s*[^,()]+,\s*["']([a-z0-9_]+)["']/gs)) {
      found.add(m[1]);
    }
    // The one `event:`-typed frame is built by a helper, not a literal envelope.
    if (/def error_frame\(/.test(src)) found.add('error');
  }
  for (const name of IGNORED) found.delete(name);
  return [...found].sort();
}

function selfTest() {
  const sample = [
    'yield Event(event="text_delta", data={})',
    'payload = {"event": "run_status", "data": {}}',
    'await emit_side_event(\n    thread_id,\n    "tool_request",\n    payload,\n)',
    'def error_frame(message: str) -> str: ...',
    'self._emit({"event": "prompt_result", "data": data})',
  ];
  const got = extractEvents(sample);
  const problems = [];
  for (const want of ['text_delta', 'run_status', 'tool_request', 'error']) {
    if (!got.includes(want)) problems.push(`missed ${want}`);
  }
  if (got.includes('prompt_result')) problems.push('did not drop an ignored name');
  if (problems.length) {
    console.error('✗ self-test failed — the event extractor is broken:\n');
    for (const p of problems) console.error(`  ${p}`);
    exit(1);
  }
  console.log('✓ self-test passed (extractor finds all three emit spellings)');
}

if (argv[2] === '--self-test') {
  selfTest();
  exit(0);
}

selfTest();

const checkout = resolve(argv[2] ?? join(homedir(), 'Projects/felix'));
if (!existsSync(join(checkout, 'apps/api/src/felix_api/app.py'))) {
  console.error(`✗ not a felix harness checkout: ${checkout}`);
  console.error('  usage: node scripts/sync-harness-contract.mjs [path-to-felix-checkout]');
  exit(2);
}

const head = execFileSync('git', ['-C', checkout, 'rev-parse', '--short', 'HEAD'], {
  encoding: 'utf8',
}).trim();

// --- routes ---
//
// `create_app()` builds the FastAPI app and `.openapi()` renders the spec, both
// without touching a database — so this reflects the source, not a deployment.
const rawSpec = execFileSync(
  'uv',
  [
    'run',
    'python',
    '-c',
    'import json;from felix_api.app import create_app;print(json.dumps(create_app().openapi()))',
  ],
  { cwd: checkout, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
);
const spec = JSON.parse(rawSpec);
const trimmed = {
  openapi: spec.openapi,
  info: { title: spec.info.title, version: spec.info.version },
  paths: Object.fromEntries(
    Object.entries(spec.paths).map(([p, ops]) => [
      p,
      Object.fromEntries(Object.keys(ops).map((verb) => [verb, {}])),
    ]),
  ),
};
writeFileSync(OPENAPI_OUT, `${JSON.stringify(trimmed, null, 2)}\n`);

// --- events ---
const sources = pythonFiles(join(checkout, 'apps'))
  .concat(pythonFiles(join(checkout, 'packages')))
  .map((f) => readFileSync(f, 'utf8'));
const emitted = extractEvents(sources);

const existing = existsSync(EVENTS_OUT) ? JSON.parse(readFileSync(EVENTS_OUT, 'utf8')) : {};
writeFileSync(
  EVENTS_OUT,
  `${JSON.stringify(
    {
      $comment:
        'Every SSE event the harness can emit, recorded from a checkout by ' +
        'scripts/sync-harness-contract.mjs. check-protocol-parity fails when one of these has ' +
        'no StreamEvent arm — the direction the type system cannot see, because the union ends ' +
        'in an open arm. Do not hand-edit: re-run the sync.',
      harnessCommit: head,
      harnessVersion: spec.info.version,
      normalised: NORMALISED,
      // Kept by hand: names the harness has stopped emitting but older
      // self-hosted deployments still send. The sync cannot infer these.
      legacy: existing.legacy ?? [],
      emitted,
    },
    null,
    2,
  )}\n`,
);

console.log(`harness ${head} (v${spec.info.version})`);
console.log(`  ${Object.keys(trimmed.paths).length} paths  → ${OPENAPI_OUT.replace(REPO, '.')}`);
console.log(`  ${emitted.length} events → ${EVENTS_OUT.replace(REPO, '.')}`);
console.log('\nReview the diff before committing — a surprise in it is the point.');
