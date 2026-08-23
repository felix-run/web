#!/usr/bin/env node
/**
 * Fail CI when a wire event has no handler in a client that should have one.
 *
 * `StreamEvent` ends in an open arm — `{ event: string; data: ... }` — so the
 * harness can gain a frame without breaking the build. That is deliberate, and
 * it is also the trap documented in .claude/rules/protocol-parity.md: an arm
 * with no matching branch in App.tsx compiles, lints, and does nothing at
 * runtime, which is indistinguishable from a frame that never arrives.
 *
 * Nothing else in this repo notices. The type system cannot: the open arm
 * absorbs every unknown event, and a `switch` over a string union with no
 * exhaustiveness check has no opinion about missing cases.
 *
 * Usage:
 *   node scripts/check-protocol-parity.mjs <types.ts> <App.tsx...>
 *   node scripts/check-protocol-parity.mjs --update <types.ts> <App.tsx...>
 *   node scripts/check-protocol-parity.mjs --self-test
 *
 * The baseline is a one-way ratchet. Gaps that predate this check are recorded
 * in protocol-parity-baseline.json so it can land green; a NEW gap fails, and a
 * gap that gets fixed must be removed from the baseline (`--update` rewrites
 * it). Counts may only go down.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { argv, cwd, exit } from 'node:process';
import { fileURLToPath } from 'node:url';

const BASELINE_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'protocol-parity-baseline.json',
);

/**
 * Every named arm of the `StreamEvent` union.
 *
 * The open arm is spelled `event: string` rather than a literal, so quoting is
 * what separates a real arm from the catch-all — no need to special-case it.
 */
export function extractArms(src) {
  const union = src.slice(src.indexOf('export type StreamEvent'));
  const end = union.indexOf('\n\n');
  const body = end === -1 ? union : union.slice(0, end);
  return [...new Set([...body.matchAll(/\bevent:\s*'([a-z0-9_]+)'/gi)].map((m) => m[1]))];
}

/**
 * Every event name a client branches on.
 *
 * Both spellings are in use — chat-ui switches, float uses if-chains — and
 * either may list several names for one branch. Matches are intersected with
 * the real arm list by the caller, so unrelated `case` labels (slash commands,
 * for one) cannot be mistaken for handlers.
 */
export function extractHandled(src) {
  const names = new Set();
  for (const m of src.matchAll(/\bcase\s+'([a-z0-9_]+)'\s*:/gi)) names.add(m[1]);
  for (const m of src.matchAll(/\bevent\.event\s*===\s*'([a-z0-9_]+)'/gi)) names.add(m[1]);
  return [...names];
}

/** `[{ client, event }]` for every arm no client branch mentions. */
export function findGaps(arms, clients) {
  const gaps = [];
  for (const { file, src } of clients) {
    const handled = new Set(extractHandled(src));
    for (const event of arms) {
      if (!handled.has(event)) gaps.push({ client: file, event });
    }
  }
  return gaps.sort((a, b) => a.client.localeCompare(b.client) || a.event.localeCompare(b.event));
}

const key = (g) => `${g.client} ${g.event}`;

function loadBaseline() {
  try {
    const parsed = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'));
    return new Set(parsed.allowed ?? []);
  } catch {
    return new Set();
  }
}

function writeBaseline(gaps) {
  const doc = {
    $comment:
      'Wire events with no handler, grandfathered so the check could land green. ' +
      'One-way ratchet: never add an entry by hand to silence a new gap — add the ' +
      'handler instead. Regenerate with `pnpm check-protocol-parity --update` only ' +
      'after FIXING something, so entries disappear.',
    allowed: gaps.map(key).sort(),
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(doc, null, 2)}\n`);
}

/**
 * Guard the guard. Both extractors are regex over source, so a refactor of how
 * the union or the handlers are spelled could quietly reduce this to finding
 * nothing — which reads as "no gaps" forever.
 */
function selfTest() {
  const types = `
export type StreamEvent =
  | { event: 'alpha'; data: { a?: string } }
  | { event: 'beta'; data: { b?: string } }
  | { event: 'gamma'; data: Record<string, unknown> }
  | { event: string; data: Record<string, unknown> };

export interface Unrelated { event: 'not_an_arm' }
`;
  const switchClient = `
    switch (ev.event) {
      case 'alpha':
      case 'beta': { break; }
      case 'clear': { break; }
    }`;
  const ifClient = `
    if (event.event === 'alpha') return;
    if (event.event === 'gamma') return;`;

  const problems = [];
  const arms = extractArms(types);
  if (arms.join(',') !== 'alpha,beta,gamma') {
    problems.push(`arms should be alpha,beta,gamma — got ${arms.join(',') || '(none)'}`);
  }

  const gaps = findGaps(arms, [
    { file: 'switch.tsx', src: switchClient },
    { file: 'if.tsx', src: ifClient },
  ]);
  const found = new Set(gaps.map(key));
  if (!found.has('switch.tsx gamma')) problems.push('missed an unhandled arm in a switch client');
  if (!found.has('if.tsx beta')) problems.push('missed an unhandled arm in an if client');
  if (found.has('switch.tsx alpha')) problems.push('false positive on a handled arm');
  if (found.has('if.tsx gamma')) problems.push('false positive on an if-handled arm');
  if ([...found].some((f) => f.endsWith(' clear'))) {
    problems.push('counted an unrelated case label as an arm');
  }
  if (arms.includes('not_an_arm')) problems.push('read past the union into another declaration');

  if (problems.length) {
    console.error('✗ self-test failed — the extractors are broken:\n');
    for (const p of problems) console.error(`  ${p}`);
    exit(1);
  }
  console.log('✓ self-test passed (extractors find unhandled arms in both client styles)');
}

const args = argv.slice(2);

if (args[0] === '--self-test') {
  selfTest();
  exit(0);
}

const update = args[0] === '--update';
const [typesPath, ...clientPaths] = update ? args.slice(1) : args;

if (!typesPath || !clientPaths.length) {
  console.error(
    'usage: check-protocol-parity.mjs [--update] <types.ts> <App.tsx...>  |  --self-test',
  );
  exit(2);
}

selfTest();

const arms = extractArms(readFileSync(typesPath, 'utf8'));
if (!arms.length) {
  console.error(`✗ found no StreamEvent arms in ${typesPath} — the union moved or was renamed.`);
  exit(1);
}

const clients = clientPaths.map((file) => ({
  file: relative(cwd(), file),
  src: readFileSync(file, 'utf8'),
}));
const gaps = findGaps(arms, clients);

if (update) {
  writeBaseline(gaps);
  console.log(`baseline rewritten: ${gaps.length} grandfathered gap(s)`);
  exit(0);
}

const baseline = loadBaseline();
const fresh = gaps.filter((g) => !baseline.has(key(g)));
const fixed = [...baseline].filter((b) => !gaps.some((g) => key(g) === b));

console.log(
  `checked ${arms.length} wire events against ${clients.length} client(s)` +
    `${baseline.size ? `, ${baseline.size} grandfathered` : ''}`,
);

if (fresh.length) {
  console.error(`\n✗ ${fresh.length} wire event(s) reach a client that ignores them:\n`);
  for (const g of fresh) console.error(`  ${g.event}  — no branch in ${g.client}`);
  console.error(
    '\nAdd the handler. A frame nobody handles is indistinguishable from one that\n' +
      'never arrives, which is a bug that presents as silence.',
  );
  exit(1);
}

if (fixed.length) {
  console.error(`\n✗ ${fixed.length} baseline entr(ies) are now handled:\n`);
  for (const f of fixed) console.error(`  ${f}`);
  console.error(
    '\nRun `pnpm check-protocol-parity --update` to bank the fix. The floor only drops.',
  );
  exit(1);
}

console.log('✓ every wire event is handled, or grandfathered');
exit(0);
