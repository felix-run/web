/**
 * A denied call: who said no, when, and what an operator can do next.
 *
 * An approval gate answering no is not a failure. Nothing broke, and the gate did
 * what it is for. Drawn as one, a single declined `write_file` read four ways —
 * red `refused` on its card and in Changes, `Failed` in the Activity ledger — and
 * its reason, *Refused: write_file was denied.*, said that it was denied and not
 * by whom. The tool result says only *that* (`[approval denied] tool=… rule=…`);
 * the who and the when are on the approval row, `GET /approvals?status=denied`,
 * which this module matches back to the card.
 *
 * Pure, apart from the one `localStorage` key that says which decisions this
 * browser made, so the matching and the sentences can be tested without a DOM.
 */
import {
  type ApprovalRequest,
  classifyToolResult,
  type ToolCall,
  type ToolResultIssue,
  type Turn,
} from '@felix/client';

/** The prefix the engine gives a call the browser ran (`client · local_write`). */
const CLIENT_PREFIX = 'client · ';

/** The harness waits five minutes for a decision when the rule sets no TTL. */
const DEFAULT_TTL_SECONDS = 300;

/** What the approval row says about one denied call. */
export interface DenialRecord {
  /** The approval row's id. */
  id: string;
  /** The principal the harness recorded as deciding, or `''`. */
  decidedBy: string;
  /** Epoch ms, or `null` when the row carries none. */
  decidedAt: number | null;
  /** How long the gate waited, in seconds. */
  ttlSeconds: number;
  /** This browser made the decision, so "you" is a claim with evidence behind it. */
  here: boolean;
}

/**
 * Approval ids this browser decided, newest last.
 *
 * `decided_by` on the row names a principal, and through the proxy every browser
 * on a deployment is the same principal (the Worker's key), so it cannot say
 * *you*. What can is this browser having made the decision, which only this
 * browser knows. Local, capped, and a convenience: losing it means a card says
 * who the harness recorded instead of "you", never something untrue.
 */
const DECIDED_HERE_KEY = 'felix.decidedHere';
const DECIDED_HERE_CAP = 200;

function readDecidedHere(): string[] {
  try {
    const raw = JSON.parse(localStorage.getItem(DECIDED_HERE_KEY) ?? '[]');
    return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Record that this browser decided approval `id`. Called once the harness took the decision. */
export function rememberDecidedHere(id: string): void {
  try {
    const ids = readDecidedHere().filter((x) => x !== id);
    ids.push(id);
    localStorage.setItem(DECIDED_HERE_KEY, JSON.stringify(ids.slice(-DECIDED_HERE_CAP)));
  } catch {
    // Blocked storage: a card says who the harness recorded rather than "you".
  }
}

export function decidedHere(id: string): boolean {
  return readDecidedHere().includes(id);
}

function bareName(name: string): string {
  return name.startsWith(CLIENT_PREFIX) ? name.slice(CLIENT_PREFIX.length) : name;
}

/** A finished call an approval gate denied, with the classifier's reading of it. */
export function denialOf(tool: ToolCall): ToolResultIssue | null {
  if (!tool.done) return null;
  const issue = classifyToolResult(bareName(tool.name), tool.output);
  return issue?.kind === 'denied' ? issue : null;
}

/** Every denied call in the transcript, in the order they happened. */
export function deniedCalls(turns: readonly Turn[]): ToolCall[] {
  const out: ToolCall[] = [];
  for (const turn of turns) for (const tool of turn.tools ?? []) if (denialOf(tool)) out.push(tool);
  return out;
}

/**
 * Each denied card's approval row, where the match is certain.
 *
 * Nothing on the card names its row: the tool result carries the tool and the
 * rule, the row carries an argument *hash* the client cannot recompute, and the
 * audit row's `tool_call_id` is not on the approval. So the match is by order:
 * the n-th denied `write_file` on this thread is the n-th denied `write_file` row
 * for it, oldest first. That holds only while the two lists agree, so a tool
 * whose counts differ — a denial on an abandoned branch, two calls that shared
 * one pending row, a row past the read's limit — gets no record at all, and its
 * card says *Denied* without a who or a when. The same refusal `rateTurn` makes
 * when positions disagree: an unattributed denial beats a misattributed one.
 */
export function matchDenials(
  turns: readonly Turn[],
  rows: readonly ApprovalRequest[],
  threadId: string,
  isHere: (id: string) => boolean = decidedHere,
): Map<ToolCall, DenialRecord> {
  const cards = new Map<string, ToolCall[]>();
  for (const tool of deniedCalls(turns)) {
    const name = bareName(tool.name);
    cards.set(name, [...(cards.get(name) ?? []), tool]);
  }
  const byTool = new Map<string, ApprovalRequest[]>();
  for (const row of rows) {
    if (row.status !== 'denied' || !row.thread_id || row.thread_id !== threadId) continue;
    byTool.set(row.tool_name, [...(byTool.get(row.tool_name) ?? []), row]);
  }
  const out = new Map<ToolCall, DenialRecord>();
  for (const [name, tools] of cards) {
    const own = (byTool.get(name) ?? []).sort((a, b) => a.created_at - b.created_at);
    if (own.length !== tools.length) continue;
    tools.forEach((tool, i) => {
      const row = own[i];
      if (!row) return;
      out.set(tool, {
        id: row.id,
        decidedBy: row.decided_by ?? '',
        decidedAt: row.decided_at ?? null,
        ttlSeconds: row.ttl_seconds ?? DEFAULT_TTL_SECONDS,
        here: isHere(row.id),
      });
    });
  }
  return out;
}

/**
 * The denied calls an operator can still ask for again: the ones in the newest
 * reply, after the last thing they sent. An older denial has had a conversation
 * since, and an "Ask again" on every one of them is a column of buttons that
 * would each reopen a question already moved past.
 */
export function askableDenials(turns: readonly Turn[]): Set<ToolCall> {
  const out = new Set<ToolCall>();
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i];
    if (!turn || turn.role === 'user') break;
    for (const tool of turn.tools ?? []) if (denialOf(tool)) out.add(tool);
  }
  return out;
}

/** `5 min`, `90 s`, `1 h 30 min`. */
export function waitLength(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h} h ${m} min` : `${h} h`;
}

/**
 * The denial's subject line: who said no, or that nobody did, and when.
 *
 * - A person: *Denied by you* only when this browser made the decision; otherwise
 *   the principal the harness recorded (`who`, drawn as the harness's word), or
 *   plain *Denied* with no row to read it from. Never "you" on a guess.
 * - A deadline: *Timed out after 5 min. The harness denied it.* — the harness
 *   decided, so naming a person would be wrong, and "timed out" alone read as a
 *   tool that hung.
 * - A Stop: the run was stopped while the call waited.
 *
 * `note` is the refuser's own words when they gave some.
 */
export interface DenialSubject {
  lead: string;
  /** The recorded principal, when the line names one that is not "you". */
  who: string | null;
  /** Epoch ms of the decision, when known. */
  at: number | null;
  /** The rest of the sentence after the time, if any. */
  tail: string | null;
  note: string | null;
}

/** Principals the harness writes when it, not a person, closed the row. */
const HARNESS_PRINCIPALS = new Set(['felix', 'system', '']);

export function denialSubject(issue: ToolResultIssue, record: DenialRecord | null): DenialSubject {
  const at = record?.decidedAt ?? null;
  if (issue.note === 'timeout') {
    return {
      lead: record ? `Timed out after ${waitLength(record.ttlSeconds)}` : 'Timed out',
      who: null,
      at,
      tail: 'The harness denied it.',
      note: null,
    };
  }
  if (issue.note === 'aborted') {
    return {
      lead: 'Stopped while it waited for approval',
      who: null,
      at,
      tail: null,
      note: null,
    };
  }
  const note = issue.note && issue.note !== 'denied' ? issue.note : null;
  if (!record) return { lead: 'Denied', who: null, at: null, tail: null, note };
  if (record.here) return { lead: 'Denied by you', who: null, at, tail: null, note };
  if (!HARNESS_PRINCIPALS.has(record.decidedBy)) {
    return { lead: 'Denied by', who: record.decidedBy, at, tail: null, note };
  }
  return { lead: 'Denied', who: null, at, tail: null, note };
}

/**
 * What "Ask again" puts in the composer. A request, in the operator's voice, for
 * the agent to make the call again — not a replay: the harness has no route that
 * re-issues one call, and the model decides whether and how to try. Editable, and
 * never sent for them.
 */
export function askAgainText(toolName: string): string {
  return `Please try the ${bareName(toolName)} call again; I'll approve it.`;
}
