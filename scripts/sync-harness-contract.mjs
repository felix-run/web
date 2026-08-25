#!/usr/bin/env node
/**
 * Re-record what the harness serves, from a harness *checkout*.
 *
 * Two files describe the hand-mirrored contract, and both were maintained by
 * hand against whatever happened to be running:
 *
 *   apps/chat-ui/harness-openapi.json  — every route, for check-api-drift
 *   scripts/harness-events.json        — every SSE event, for check-protocol-parity
 *   scripts/harness-payloads.json      — every response row shape, for check-payload-shapes
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
const PAYLOADS_OUT = join(REPO, 'scripts/harness-payloads.json');

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

/**
 * The key set of every row the harness serialises for a JSON response.
 *
 * The OpenAPI spec cannot answer this. Every route returns a bare `dict`, so
 * FastAPI documents all 78 JSON responses as `{"type": "object",
 * "additionalProperties": true}` and the only component schemas in the spec are
 * the 31 *request* models. The response side of the contract exists solely as
 * dict literals in the store modules — `felix/<area>/store.py` — by a convention
 * the harness holds to: one `_<row>_dict(row)` per table, every key spelled out.
 *
 * Keys are collected at depth 1 of each returned object literal, so a nested
 * payload contributes its own name and not its contents. A serializer with two
 * return branches (the ORM row and the in-memory dict) yields their union, which
 * is what a client must tolerate anyway.
 *
 * A serializer that builds its dict imperatively has no literal to read —
 * `_task_dict` mutates a copy of the stored blob key by key — and is listed under
 * `unreadable` rather than dropped. An omission nothing records is the failure
 * this repo keeps meeting; a guarded type pointed at one of those names fails in
 * check-payload-shapes instead of quietly checking nothing.
 */
export function extractPayloads(files) {
  const payloads = {};
  const unreadable = [];
  for (const { path, text } of files) {
    for (const m of text.matchAll(/^def (_[a-z0-9_]*dict)\(/gm)) {
      const label = `${path}:${m[1]}`;
      const keys = objectKeys(text.slice(m.index));
      if (keys.length) payloads[label] = keys;
      else unreadable.push(label);
    }
  }
  const sort = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
  return { payloads: sort(payloads), unreadable: unreadable.sort() };
}

/**
 * Depth-1 keys of every `return {…}` in the first function of `src`.
 *
 * A character scanner rather than a regex: indentation is not reliable across
 * modules, and a nested literal would otherwise contribute keys that never
 * appear on the wire.
 */
function objectKeys(src) {
  const body = src.split(/\n(?=@|def |async def )/)[0];
  const keys = new Set();
  for (const start of [...body.matchAll(/\breturn\s*\{/g)]) {
    let depth = 0;
    let quote = '';
    for (let i = start.index + start[0].length - 1; i < body.length; i++) {
      const c = body[i];
      if (quote) {
        if (c === '\\') i++;
        else if (c === quote) quote = '';
        continue;
      }
      if (c === '"' || c === "'") {
        if (depth === 1) {
          const key = /^(["'])([A-Za-z_][A-Za-z0-9_]*)\1\s*:/.exec(body.slice(i));
          if (key) keys.add(key[2]);
        }
        quote = c;
        continue;
      }
      if (c === '{' || c === '[' || c === '(') depth++;
      else if (c === '}' || c === ']' || c === ')') {
        depth--;
        if (depth === 0) break;
      }
    }
  }
  return [...keys];
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

  const { payloads, unreadable } = extractPayloads([
    {
      path: 'felix/x/store.py',
      text: [
        'def _row_dict(row: Row | dict[str, Any]) -> dict[str, Any]:',
        '    if isinstance(row, dict):',
        '        return {"id": row["id"], "legacy": row.get("legacy")}',
        '    return {',
        '        "id": row.id,',
        '        "payload_json": {"nested": row.inner, "deeper": [{"no": 1}]},',
        '    }',
        '',
        'def unrelated() -> None:',
        '    return {"not_a_row": 1}',
        '',
        'def _built_dict(row: Row) -> dict[str, Any]:',
        '    out = dict(row.blob)',
        '    out["id"] = row.id',
        '    return out',
      ].join('\n'),
    },
  ]);
  const keys = payloads['felix/x/store.py:_row_dict'] ?? [];
  if (!keys.includes('payload_json')) problems.push('missed a serialised key');
  if (!keys.includes('legacy')) problems.push('missed the second return branch');
  if (keys.includes('nested') || keys.includes('no')) problems.push('collected a nested key');
  if (payloads['felix/x/store.py:unrelated']) problems.push('read a non-serializer function');
  if (!unreadable.includes('felix/x/store.py:_built_dict')) {
    problems.push('dropped an imperative serializer instead of reporting it');
  }
  if (problems.length) {
    console.error('✗ self-test failed — an extractor is broken:\n');
    for (const p of problems) console.error(`  ${p}`);
    exit(1);
  }
  console.log('✓ self-test passed (extractors find all three emit spellings, and row keys)');
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
const files = pythonFiles(join(checkout, 'apps'))
  .concat(pythonFiles(join(checkout, 'packages')))
  .map((f) => ({
    // Relative to the package root rather than the checkout, so the label is
    // stable across the two source trees and survives a repo reorganisation.
    path: f.slice(f.indexOf('/src/') + 5) || f,
    text: readFileSync(f, 'utf8'),
  }));
const emitted = extractEvents(files.map((f) => f.text));

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
      // self-hosted deployments still send, and the note saying why they are
      // here. The sync cannot infer either, and dropping the note on every
      // re-record would leave the list looking like cruft to delete.
      $legacyComment: existing.$legacyComment,
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

// --- payload shapes ---
const { payloads, unreadable } = extractPayloads(files);
writeFileSync(
  PAYLOADS_OUT,
  `${JSON.stringify(
    {
      $comment:
        'The key set of every row the harness serialises, recorded from a checkout by ' +
        'scripts/sync-harness-contract.mjs. check-payload-shapes fails when a client type ' +
        'requires a field that is not in one of these sets — the `payload` vs `payload_json` ' +
        'bug, which typechecks, lints, drifts past check-api-drift (it reads paths, not ' +
        'shapes) and renders `undefined` forever. Do not hand-edit: re-run the sync.',
      harnessCommit: head,
      harnessVersion: spec.info.version,
      // Serializers with no dict literal to read. Named so a guarded type
      // pointed at one fails loudly rather than checking nothing.
      unreadable,
      payloads,
    },
    null,
    2,
  )}\n`,
);
console.log(`  ${Object.keys(payloads).length} row shapes → ${PAYLOADS_OUT.replace(REPO, '.')}`);
console.log('\nReview the diff before committing — a surprise in it is the point.');
