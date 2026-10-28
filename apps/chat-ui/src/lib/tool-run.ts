import { type FileToolOp, fileToolOp } from '@felix/client';

/** The fewest consecutive routine calls folded into one line; two cards are not a wall. */
export const MIN_RUN = 3;

const FILE_PHRASE: Record<FileToolOp, [verb: string, one: string, many: string]> = {
  read: ['read', 'file', 'files'],
  list: ['listed', 'folder', 'folders'],
  search: ['searched', 'time', 'times'],
  write: ['wrote', 'file', 'files'],
  edit: ['edited', 'file', 'files'],
  delete: ['deleted', 'file', 'files'],
  rename: ['renamed', 'file', 'files'],
};

/** The phrase for one kind of call, keyed so a run counts each kind once. */
function phraseOf(name: string, shell: boolean): { key: string; say: (n: number) => string } {
  const op = fileToolOp(name);
  if (op) {
    const [verb, one, many] = FILE_PHRASE[op];
    // "searched 2 times" reads oddly for one: a single search is just "searched".
    if (op === 'search') return { key: op, say: (n) => (n === 1 ? verb : `${verb} ${n} ${many}`) };
    return { key: op, say: (n) => `${verb} ${n} ${n === 1 ? one : many}` };
  }
  if (shell) {
    return { key: 'shell', say: (n) => `ran ${n} ${n === 1 ? 'command' : 'commands'}` };
  }
  return { key: `tool:${name}`, say: (n) => (n === 1 ? `called ${name}` : `called ${name} ×${n}`) };
}

/**
 * A run of calls in a sentence: `Read 3 files, ran 2 commands`, in the order each kind first
 * appears, at most three kinds and then how many calls are left. Our words, not the harness's
 * names, except for a tool we have no verb for, which is named as itself. `shell` marks a call
 * whose result is a shell result, since a manifest names its shell tools whatever it likes.
 */
export function summarizeRun(calls: readonly { name: string; shell: boolean }[]): string {
  const counts = new Map<string, { say: (n: number) => string; n: number }>();
  for (const { name, shell } of calls) {
    const { key, say } = phraseOf(name, shell);
    const seen = counts.get(key);
    if (seen) seen.n += 1;
    else counts.set(key, { say, n: 1 });
  }
  const kinds = [...counts.values()];
  const shown = kinds.slice(0, 3).map((k) => k.say(k.n));
  const rest = kinds.slice(3).reduce((sum, k) => sum + k.n, 0);
  if (rest) shown.push(`${rest} more ${rest === 1 ? 'call' : 'calls'}`);
  const text = shown.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}
