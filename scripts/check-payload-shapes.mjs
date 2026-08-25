#!/usr/bin/env node
/**
 * Fail CI when a client type requires a field the harness does not send.
 *
 * This is the third direction of the same hand-mirrored contract, and the one
 * nothing else could see. `check-api-drift` compares paths and verbs;
 * `check-protocol-parity` compares event names. Neither reads a *shape*, and the
 * OpenAPI snapshot cannot help: every harness route returns a bare `dict`, so
 * FastAPI documents all 78 JSON responses as `additionalProperties: true` and
 * the only component schemas in the spec are the 31 request models.
 *
 * So the failure is silent all the way down. `api.ts` reads a response with
 * `(await res.json()) as T` — nine call sites do — and a field the harness spells
 * differently is simply `undefined` at runtime. It typechecks, it lints, it
 * drifts past every existing guard, and it renders forever as a blank or a
 * fallback. On 2026-08-25 `AuditEvent.payload` had been `undefined` on every row
 * the harness ever returned, because the wire spells it `payload_json`: the
 * Activity feed showed the manifest's name — "quick" — once per row, with no
 * second line, and nothing anywhere reported a problem.
 *
 * The response side of the contract exists only as dict literals in the harness's
 * store modules. `scripts/harness-payloads.json` records their key sets from a
 * checkout; this compares each guarded type against the set it mirrors.
 *
 *   required client field, not sent by the harness  → fail (it is always undefined)
 *   optional client field,  not sent by the harness  → fine (that is what `?` claims)
 *   harness field nothing models                     → advisory
 *
 * Optionality carries the whole distinction on purpose. A client that writes
 * `payload?:` has said the field may be absent and handles it; a client that
 * writes `payload:` has promised the reader it is there.
 *
 * Usage:
 *   node scripts/check-payload-shapes.mjs [<record>]
 *   node scripts/check-payload-shapes.mjs --self-test
 *
 * A guarded entry naming a serializer the record does not carry fails, including
 * one the recorder listed as `unreadable` — a guard that silently checks nothing
 * is worse than no guard, which is the lesson `check-tailwind-sources` was
 * written from.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { argv, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DEFAULT_RECORD = 'scripts/harness-payloads.json';

/**
 * Every client type that mirrors a harness row, and the serializer it mirrors.
 *
 * Guard the *wire* type, never the normalised one. `listAudit` maps `payload_json`
 * onto `payload`, so `AuditEvent` deliberately carries a field no response has —
 * that is the fix, not a drift. The type to check is the one the cast produces.
 */
export const GUARDED = [
  {
    type: 'AuditEventWire',
    file: 'apps/chat-ui/src/types.ts',
    serializer: 'felix/audit/store.py:_event_dict',
  },
  {
    type: 'ApprovalRequest',
    file: 'apps/chat-ui/src/types.ts',
    serializer: 'felix/approvals/store.py:_approval_dict',
  },
  {
    type: 'UsageEvent',
    file: 'apps/chat-ui/src/types.ts',
    serializer: 'felix/usage/store.py:_event_dict',
  },
  {
    type: 'MemoryRecord',
    file: 'apps/chat-ui/src/types.ts',
    serializer: 'felix/memory/store.py:_row_dict',
  },
  {
    type: 'PlanWire',
    file: 'apps/chat-ui/src/types.ts',
    serializer: 'felix/plans/store.py:_plan_dict',
  },
];

/**
 * The declared fields of one exported interface, and whether each is optional.
 *
 * Resolves the two inheritance forms this repo uses — `extends Base` and
 * `extends Omit<Base, 'a' | 'b'>` — because a wire type is usually spelled as a
 * difference from the normalised one. Anything else in an `extends` clause
 * throws rather than being read as an empty base: a silently mis-parsed type
 * would report a clean bill of health for a type it never looked at.
 */
export function interfaceFields(src, name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`circular extends at ${name}`);
  seen.add(name);
  const decl = new RegExp(`\\binterface\\s+${name}\\b([^{]*)\\{`).exec(src);
  if (!decl) throw new Error(`no interface ${name}`);

  const fields = new Map();
  const clause = decl[1].trim();
  if (clause) {
    const ext = /^extends\s+(.+)$/.exec(clause);
    if (!ext) throw new Error(`unreadable declaration for ${name}: ${clause}`);
    const omit = /^Omit<\s*([A-Za-z0-9_]+)\s*,\s*(.+?)\s*>$/.exec(ext[1].trim());
    const plain = /^([A-Za-z0-9_]+)$/.exec(ext[1].trim());
    if (omit) {
      const dropped = new Set([...omit[2].matchAll(/'([^']+)'/g)].map((m) => m[1]));
      for (const [k, v] of interfaceFields(src, omit[1], seen)) {
        if (!dropped.has(k)) fields.set(k, v);
      }
    } else if (plain) {
      for (const [k, v] of interfaceFields(src, plain[1], seen)) fields.set(k, v);
    } else {
      throw new Error(`unreadable extends for ${name}: ${ext[1]}`);
    }
  }

  // Depth 1 only: a nested object type declares fields of its own, and those
  // are not fields of this row.
  const body = src.slice(decl.index + decl[0].length);
  let depth = 1;
  let line = '';
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) break;
    }
    if (c === '\n') {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)(\??):/.exec(line);
      if (m && depth === 1) fields.set(m[1], m[2] === '?');
      line = '';
    } else line += c;
  }
  return fields;
}

/** Compare one guarded type against the key set the harness sends. */
export function compare(fields, sent) {
  const missing = [...fields].filter(([k, optional]) => !optional && !sent.includes(k));
  const unmodelled = sent.filter((k) => !fields.has(k));
  return { missing: missing.map(([k]) => k), unmodelled };
}

function selfTest() {
  const src = [
    'export interface Row {',
    '  id: string;',
    '  payload: Record<string, unknown>;',
    '}',
    "export interface RowWire extends Omit<Row, 'payload'> {",
    '  payload_json?: Record<string, unknown>;',
    '  principal_subject: string;',
    '  nested: { inner: string };',
    '}',
  ].join('\n');
  const problems = [];

  const wire = interfaceFields(src, 'RowWire');
  if (!wire.has('id')) problems.push('lost a field inherited through Omit');
  if (wire.has('payload')) problems.push('kept a field Omit removed');
  if (wire.has('inner')) problems.push('read a nested field as a row field');
  if (wire.get('payload_json') !== true) problems.push('did not read `?` as optional');

  const got = compare(wire, ['id', 'payload_json', 'principal_subj']);
  if (!got.missing.includes('principal_subject')) problems.push('missed a required field');
  if (got.missing.includes('payload_json')) problems.push('flagged an optional field');
  if (!got.unmodelled.includes('principal_subj')) problems.push('missed an unmodelled field');

  let threw = false;
  try {
    interfaceFields('export interface A extends Pick<B, "x"> {}', 'A');
  } catch {
    threw = true;
  }
  if (!threw) problems.push('read an unsupported extends clause as empty');

  if (problems.length) {
    console.error('✗ self-test failed — the shape comparison is broken:\n');
    for (const p of problems) console.error(`  ${p}`);
    exit(1);
  }
  console.log('✓ self-test passed (Omit resolved, optionality honoured, bad extends refused)');
}

if (argv[2] === '--self-test') {
  selfTest();
  exit(0);
}

selfTest();

const record = JSON.parse(readFileSync(resolve(REPO, argv[2] ?? DEFAULT_RECORD), 'utf8'));
const unreadable = new Set(record.unreadable ?? []);
const failures = [];
const advisories = [];

for (const g of GUARDED) {
  if (!record.payloads[g.serializer]) {
    failures.push(
      unreadable.has(g.serializer)
        ? `${g.type} → ${g.serializer}\n      the recorder could not read that serializer, so this guard checks nothing`
        : `${g.type} → ${g.serializer}\n      no such serializer in the record — renamed or moved in the harness?`,
    );
    continue;
  }
  const src = readFileSync(join(REPO, g.file), 'utf8');
  const { missing, unmodelled } = compare(
    interfaceFields(src, g.type),
    record.payloads[g.serializer],
  );
  for (const f of missing) {
    failures.push(
      `${g.file} → ${g.type}.${f}\n      required, and ${g.serializer} never sends it — always undefined`,
    );
  }
  if (unmodelled.length) advisories.push(`  ${g.type}: ${unmodelled.join(', ')}`);
}

console.log(
  `checked ${GUARDED.length} client type(s) against harness ${record.harnessCommit} ` +
    `(v${record.harnessVersion}), ${Object.keys(record.payloads).length} row shapes recorded`,
);

if (advisories.length) {
  console.log('\n  field(s) the harness sends that nothing models:');
  for (const a of advisories) console.log(a);
  console.log('  (advisory — a row carries more than any one panel needs)');
}

if (failures.length) {
  console.error(`\n✗ ${failures.length} field(s) can never arrive:\n`);
  for (const f of failures) console.error(`    ${f}`);
  console.error('\n  Fix the client type, or mark the field optional if it is genuinely');
  console.error('  sometimes absent. Re-record with `pnpm sync:harness` first if the');
  console.error('  harness is the thing that changed.');
  exit(1);
}

console.log('\n✓ every required field is one the harness sends');
