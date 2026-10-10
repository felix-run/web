/**
 * What a finished tool call's result says happened, when that was not success.
 *
 * A tool card used to draw every finished call as `done`, including one whose output was an error:
 * on the reference deployment a `write_file` that failed with `Errno 13` sat under a green
 * `done` badge. The harness spells failures and refusals in a small, fixed set of prefixes — the
 * same `FAILURE_CONTENT_PREFIXES` its eval trajectory reads — so a client can tell them apart from
 * the text alone, which is all a card has once the result is a string.
 *
 * Only the *start* of the output is read, for the same reason `parseArtifactMarker` reads only the
 * end: a tool whose output merely quotes one of these markers mid-text is talking about a failure,
 * not reporting one.
 */
import { describeRefusal, parseApprovalOutcome } from './approvals';
import { fileToolOp } from './local-files';

export interface ToolResultIssue {
  /**
   * `failed`: the call ran into an error. `refused`: a control (a policy rule, a limit,
   * a guardrail) stopped it before it ran. `denied`: an approval gate answered no, or
   * nobody answered before its deadline and the harness answered no for them.
   *
   * `denied` is its own kind because it is not a failure: nothing broke, and the
   * gate did exactly what it is for. Drawn as one, a write an operator declined
   * read as red in four places, and the run beside it as having gone wrong.
   */
  kind: 'failed' | 'refused' | 'denied';
  /** Short badge text for the card. */
  label: string;
  /** The sentence to show in place of the raw output. */
  message: string;
  /** The harness's error code, for a `[tool error/<code>]` result. */
  code?: string;
  /**
   * For `denied`: the approval outcome's note as the harness wrote it: `denied`
   * (someone said no without a word), `timeout` (nobody answered), `aborted` (the
   * run was stopped while it waited), or the refuser's own note.
   */
  note?: string;
}

/**
 * Workspace tools on a harness older than `felix-run/felix#308` returned failures as plain
 * `error: …` text with no marker, and the client file tools (`local_read`, …) answer that way
 * by design. The spelling is honoured for file tools only (`fileToolOp`), since `error:` at
 * the start of an arbitrary tool's output is not a convention anything else follows.
 */

/** Controls that stop a call before it runs, by the prefix the harness gives their denial. */
const REFUSAL_PREFIXES: ReadonlyArray<readonly [prefix: string, control: string]> = [
  ['[policy ', 'policy'],
  ['[limits]', 'limits'],
  ['[guardrails]', 'guardrails'],
  ['[screening ', 'screening'],
  ['[command ', 'command screening'],
  ['[judge ', 'judge'],
];

const TOOL_ERROR = /^\[tool error\/([a-z_]+)\]\s*/;
const RUNNER_ERROR = /^\[(error|fatal)\/[^\]]*\]\s*/;
/**
 * The harness's refusal of arguments that fail the tool's schema, written by `define_tool`. It
 * starts with `[`, so the harness adds no `[tool error/...]` in front, and a card read it as done.
 */
const INVALID_ARGS = /^\[invalid args for [^\]]*\]\s*/;

/** Human wording for the harness's `ToolErrorCode`s. */
function codeLabel(code: string): string {
  switch (code) {
    case 'permission_denied':
      return 'permission denied';
    case 'invalid_arguments':
      return 'invalid arguments';
    case 'transport_unavailable':
      return 'unavailable';
    case 'timeout':
      return 'timed out';
    case 'rate_limited':
      return 'rate limited';
    default:
      return 'failed';
  }
}

/** A reason to draw this call as something other than a success, or `null` when it succeeded. */
export function classifyToolResult(toolName: string, output: unknown): ToolResultIssue | null {
  if (typeof output !== 'string') return null;

  const approval = parseApprovalOutcome(output);
  if (approval) {
    const message = describeRefusal(approval);
    if (!message) return null; // `[approval required]` is waiting, not refused
    // One word for every way a gate says no (a person, a deadline, a Stop) so
    // the card, the Changes list and the Activity ledger agree. The sentence
    // says which it was.
    return { kind: 'denied', label: 'denied', message, note: approval.note };
  }

  const toolError = TOOL_ERROR.exec(output);
  if (toolError?.[1]) {
    const code = toolError[1];
    return {
      kind: 'failed',
      label: codeLabel(code),
      message: output.slice(toolError[0].length),
      code,
    };
  }

  const invalidArgs = INVALID_ARGS.exec(output);
  if (invalidArgs) {
    return {
      kind: 'failed',
      label: codeLabel('invalid_arguments'),
      message: output.slice(invalidArgs[0].length) || output,
      code: 'invalid_arguments',
    };
  }

  const runnerError = RUNNER_ERROR.exec(output);
  if (runnerError) {
    return {
      kind: 'failed',
      label: 'failed',
      message: output.slice(runnerError[0].length) || output,
    };
  }

  for (const [prefix, control] of REFUSAL_PREFIXES) {
    if (output.startsWith(prefix)) {
      return { kind: 'refused', label: `refused by ${control}`, message: output };
    }
  }

  if (fileToolOp(toolName) !== null && output.startsWith('error: ')) {
    const message = output.slice('error: '.length);
    return {
      kind: 'failed',
      label: /permission denied|errno 13/i.test(message) ? 'permission denied' : 'failed',
      message,
    };
  }

  return null;
}
