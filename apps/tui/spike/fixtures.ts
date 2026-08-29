/**
 * Enough of a session to exercise every branch both components have: a user
 * turn, prose, a fenced code block, reasoning, a finished tool card, a running
 * one, a client tool, one awaiting approval, per-turn usage — and more threads
 * than the rail can draw, so `railWindow` is actually doing something.
 */

import type { ThreadMeta, Turn } from '@felix/client';

const A1 =
  'Because a clean end is **not** the end of the thread.\n\nThe harness closes an idle reattach at ~300s and expects the client back, so the loop re-checks `phase` and returns only while it is still working.\n\n- a torn-down run is not a live one\n- the UI must say what *landed*\n\n```ts\nif (snapshot.phase === "working") continue;\nreturn;\n```\n\nThat is the whole rule.';

const A2 =
  'It has to fire *before* the executor deadline, otherwise a `y` pressed after the timeout still writes.';

/** Cards open at the boundary the prose had reached — never mid-word. */
const at = (hay: string, needle: string) => hay.indexOf(needle) + needle.length;

export const TURNS: Turn[] = [
  { id: 'u1', role: 'user', content: 'why is the reattach loop re-checking phase?' },
  {
    id: 'a1',
    role: 'assistant',
    content: A1,
    reasoning: [
      {
        text: 'The question is really about whether a closed stream means the run ended. It does not.',
      } as never,
    ],
    tools: [
      { name: 'read_file', input: { path: 'packages/felix-client/src/reattach.ts' }, done: true, at: at(A1, 'the thread.') },
      { name: 'client · fs.read', input: { path: 'apps/tui/src/app.tsx' }, done: true, at: at(A1, 'still working.') },
      { name: 'grep', input: { query: 'Last-Event-ID' }, done: false, phase: 'running', at: at(A1, '*landed*') },
    ],
    usage: { input: 4182, output: 611 } as never,
  },
  { id: 'u2', role: 'user', content: 'and the write prompt deadline?' },
  {
    id: 'a2',
    role: 'assistant',
    content: A2,
    tools: [
      { name: 'approval · shell', input: { command: 'rm -rf dist && pnpm build' }, done: false, at: at(A2, 'still writes.') },
    ],
  },
];

const TITLES = [
  'reattach loop phase check',
  'thread rail windowing',
  'composer nested update limit',
  'bracketed paste flattening',
  'focus reports as input',
  'settleClientTool deadline',
  'symlink containment in workspace',
  'OSC 9 attention signals',
  'prompt history self-healing',
  'turn labels round trip',
  'artifact marker parsing',
  'memory soft delete',
  'lease 409 on second tab',
  'durable run progress frames',
  'manifest variant header',
  'session snapshot hydration',
  'sticky interrupt banners',
  'tailwind source guard',
  'payload shape recorder',
  'protocol parity ratchet',
  'openapi drift walker',
  'biome catalog drift',
  'docs sidebar is manual',
  'starlight theme is generated',
];

export const THREADS: ThreadMeta[] = TITLES.map((title, i) => ({
  id: `t${i}`,
  title,
  manifest: 'default',
  updatedAt: Date.now() - i * 3_600_000,
  onServer: i !== 3 && i !== 11,
}));
