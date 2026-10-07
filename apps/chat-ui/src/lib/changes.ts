/**
 * What this thread's tool calls did to each workspace path, built only from what
 * the calls themselves prove.
 *
 * The workspace zone's list used to be bare paths — "touched" — which answered
 * *where* the agent had been and not *what it did there*. A read and a rewrite
 * looked the same. This folds every call per path and says, at a glance, which
 * paths changed and by how much.
 *
 * "By how much" is held to the evidence on the call:
 *
 * - An `edit_file` carries the text it replaced and the text it put there, so its
 *   stat is `+N −M` lines of those two strings — the size of the replacement, not
 *   a line diff of the file, which nothing here holds.
 * - A `write_file` carries only what it wrote. Once it has landed nobody holds the
 *   file's before-state (the approval card's `before` is read at decision time
 *   and gone after), so its stat is `+N written` and never a minus: drawing a
 *   diff against nothing would claim the file used to be empty.
 * - A call whose result the harness marked as a failure or a refusal changed
 *   nothing, whatever its arguments said. It is reported as `failed`/`refused`
 *   and contributes to no count.
 *
 * Which calls count at all is `collectTouchedPaths`' allowlist — a workspace
 * tool's path argument and nothing else — never the mention heuristic.
 */
import { classifyToolResult, fileToolOp, type ToolCall, type Turn } from '@felix/client';
import { collectTouchedPaths } from '@felix/cowork-client';

/** The prefix the engine gives a call the browser ran (`client · local_shell`). */
const CLIENT_PREFIX = 'client · ';

export type CallKind = 'write' | 'append' | 'edit' | 'read' | 'list' | 'search' | 'shell' | 'open';

export type CallOutcome = 'running' | 'landed' | 'failed' | 'refused';

/** One call against one path. */
export interface PathCall {
  kind: CallKind;
  outcome: CallOutcome;
  /** The harness's wording for a failure or refusal, for the evidence pane. */
  issue?: string;
  /**
   * The classifier's short name for it — `permission denied`, `timed out`,
   * `not approved in time` — the same badge the call's tool card wears. A row
   * that said `failed` beside a card saying `permission denied` was two words
   * for one fact.
   */
  label?: string;
  tool: ToolCall;
}

/** The evidence for the newest call that tried to change a path. */
export type ChangeEvidence =
  | { kind: 'edit'; oldText: string; newText: string; issue?: string }
  | { kind: 'write' | 'append'; content: string; issue?: string };

export interface PathChange {
  path: string;
  /** A write or edit was attempted here — the group that sorts first. */
  mutating: boolean;
  /** At least one write or edit *landed*: the file is not what it was. */
  changed: boolean;
  /** Newest first. */
  calls: PathCall[];
  /** The stat, split into the part that counts and the part that is a state. */
  stat: ChangeStat;
  evidence: ChangeEvidence | null;
}

/**
 * What the row's stat reads. `tone` is the colour the words take: `count` is the
 * plain mono figure, `pending` muted, `failed` the failure ramp — always as a
 * word beside it, never the colour alone.
 */
export interface ChangeStat {
  text: string;
  tone: 'count' | 'pending' | 'failed';
}

/** Line count of a string as an editor would number it: `''` is 0, a trailing newline adds none. */
export function countLines(text: string): number {
  if (!text) return 0;
  const n = text.split('\n').length;
  return text.endsWith('\n') ? n - 1 : n;
}

function bareName(name: string): string {
  return name.startsWith(CLIENT_PREFIX) ? name.slice(CLIENT_PREFIX.length) : name;
}

function record(input: unknown): Record<string, unknown> {
  return input !== null && typeof input === 'object' && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
}

function kindOf(name: string, args: Record<string, unknown>): CallKind | null {
  // The harness's workspace tools and the client's `local_*` file tools, as one set.
  const op = fileToolOp(name);
  if (op === 'write') return args.append === true ? 'append' : 'write';
  if (op) return op;
  switch (name) {
    case 'local_shell':
      return 'shell';
    case 'local_open':
      return 'open';
    default:
      return null;
  }
}

const MUTATING: ReadonlySet<CallKind> = new Set(['write', 'append', 'edit']);

/** The verb a landed non-mutating call reads as. */
const VERB: Record<Exclude<CallKind, 'write' | 'append' | 'edit'>, string> = {
  read: 'read',
  list: 'listed',
  search: 'searched',
  shell: 'ran in',
  open: 'opened',
};

/** What a call still in flight reads as. */
const PROGRESSIVE: Record<CallKind, string> = {
  write: 'writing…',
  append: 'appending…',
  edit: 'editing…',
  read: 'reading…',
  list: 'listing…',
  search: 'searching…',
  shell: 'running…',
  open: 'opening…',
};

function outcomeOf(
  name: string,
  tool: ToolCall,
): { outcome: CallOutcome; issue?: string; label?: string } {
  if (!tool.done) return { outcome: 'running' };
  const issue = classifyToolResult(name, tool.output);
  if (!issue) return { outcome: 'landed' };
  return { outcome: issue.kind, issue: issue.message || issue.label, label: issue.label };
}

/** A failed or refused call's word: the classifier's, or the outcome's when it has none. */
function failureWord(call: PathCall | undefined): string {
  return call?.label || (call?.outcome === 'refused' ? 'refused' : 'failed');
}

/**
 * How many matches an edit replaced, when its result says. The harness answers
 * `{"path", "replacements", "bytes"}`; anything else is not evidence of a count.
 */
function replacementsOf(output: unknown): number | null {
  let value: unknown = output;
  if (typeof output === 'string') {
    if (!output.trimStart().startsWith('{')) return null;
    try {
      value = JSON.parse(output);
    } catch {
      return null;
    }
  }
  const n = record(value).replacements;
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null;
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * The stat for one path, from its calls newest first.
 *
 * For a path that was changed: the newest whole-file write that landed, then
 * the edits that landed after it, summed — a write replaces the file, so edits
 * before it describe content that no longer exists.
 */
function statOf(calls: readonly PathCall[]): ChangeStat {
  const newest = calls[0];
  if (newest?.outcome === 'running') return { text: PROGRESSIVE[newest.kind], tone: 'pending' };

  const mutations = calls.filter((c) => MUTATING.has(c.kind));
  if (mutations.length > 0) {
    const parts: string[] = [];
    let added = 0;
    let removed = 0;
    let edits = 0;
    let perMatch = false;
    for (const call of mutations) {
      if (call.outcome !== 'landed') continue;
      const args = record(call.tool.input);
      if (call.kind === 'edit') {
        const replaced = replacementsOf(call.tool.output);
        // `replace_all` without a count on the result: the strings prove the size
        // of one replacement and not how many there were.
        if (replaced === null && args.replace_all === true) perMatch = true;
        const times = replaced ?? 1;
        added += countLines(str(args.new_string)) * times;
        removed += countLines(str(args.old_string)) * times;
        edits++;
        continue;
      }
      parts.push(
        `+${countLines(str(args.content))} ${call.kind === 'append' ? 'appended' : 'written'}`,
      );
      break;
    }
    if (edits > 0) parts.unshift(`+${added} −${removed}${perMatch ? ' each' : ''}`);
    // Newest first was the walk; read oldest first, the way it happened.
    if (parts.length > 0) return { text: parts.reverse().join(' · '), tone: 'count' };
    // Every attempt failed: report the newest, as a word.
    const last = mutations[0];
    return { text: failureWord(last), tone: 'failed' };
  }

  const counts = new Map<CallKind, number>();
  for (const call of calls) {
    if (call.outcome !== 'landed') continue;
    counts.set(call.kind, (counts.get(call.kind) ?? 0) + 1);
  }
  if (counts.size === 0) {
    return { text: failureWord(newest), tone: 'failed' };
  }
  const words = [...counts].map(([kind, n]) => {
    const verb = VERB[kind as keyof typeof VERB];
    return n > 1 ? `${verb} ×${n}` : verb;
  });
  return { text: words.join(' · '), tone: 'count' };
}

function evidenceOf(calls: readonly PathCall[]): ChangeEvidence | null {
  const call = calls.find((c) => MUTATING.has(c.kind));
  if (!call) return null;
  const args = record(call.tool.input);
  const issue = call.outcome === 'failed' || call.outcome === 'refused' ? call.issue : undefined;
  if (call.kind === 'edit') {
    return { kind: 'edit', oldText: str(args.old_string), newText: str(args.new_string), issue };
  }
  return { kind: call.kind === 'append' ? 'append' : 'write', content: str(args.content), issue };
}

/**
 * Every workspace path this transcript's tool calls named, with what was done
 * to it: paths a write or edit was attempted on first, then the rest, each group
 * newest first.
 */
export function collectChanges(turns: readonly Turn[]): PathChange[] {
  const byPath = new Map<string, { calls: PathCall[]; newest: number }>();
  let order = 0;
  for (const turn of turns) {
    for (const tool of turn.tools ?? []) {
      order++;
      const name = bareName(tool.name);
      const kind = kindOf(name, record(tool.input));
      if (!kind) continue;
      const { outcome, issue, label } = outcomeOf(name, tool);
      for (const path of collectTouchedPaths(tool.name, tool.input)) {
        const entry = byPath.get(path) ?? { calls: [], newest: 0 };
        entry.calls.unshift({ kind, outcome, issue, label, tool });
        entry.newest = order;
        byPath.set(path, entry);
      }
    }
  }

  const rows = [...byPath].map(([path, { calls, newest }]) => {
    const mutating = calls.some((c) => MUTATING.has(c.kind));
    const change: PathChange = {
      path,
      mutating,
      changed: calls.some((c) => MUTATING.has(c.kind) && c.outcome === 'landed'),
      calls,
      stat: statOf(calls),
      evidence: evidenceOf(calls),
    };
    return { change, newest };
  });
  rows.sort((a, b) => Number(b.change.mutating) - Number(a.change.mutating) || b.newest - a.newest);
  return rows.map((r) => r.change);
}

/**
 * The run on screen is a durable one still in flight.
 *
 * The engine marks the status turn with `runStatus` while it is a durable run's
 * status line and clears it when the answer replaces it; `streaming` guards the
 * one path that can leave the mark behind (a run that ended in an error keeps its
 * last status line). Both are needed: either alone over-reports.
 */
export function durableRunInFlight(turns: readonly Turn[], streaming: boolean): boolean {
  return streaming && turns[turns.length - 1]?.runStatus !== undefined;
}

/**
 * Whether the run in flight has reported any tool call yet: the turns after the
 * last user turn. A newer harness folds a durable run's session events into the
 * transcript as they land, so "the list is empty during a durable run" holds only
 * until the first one does.
 */
export function runHasToolCalls(turns: readonly Turn[]): boolean {
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (!turn || turn.role === 'user') return false;
    if ((turn.tools?.length ?? 0) > 0) return true;
  }
  return false;
}
