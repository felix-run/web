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

export interface ToolResultIssue {
  /** `failed`: the call ran into an error. `refused`: a control stopped it before it ran. */
  kind: 'failed' | 'refused';
  /** Short badge text for the card. */
  label: string;
  /** The sentence to show in place of the raw output. */
  message: string;
  /** The harness's error code, for a `[tool error/<code>]` result. */
  code?: string;
}

/**
 * Workspace tools on a harness older than `felix-run/felix#308` returned failures as plain
 * `error: …` text with no marker. Production ran such a harness when this was written, so the
 * spelling is honoured — but only for these tools, since `error:` at the start of an arbitrary
 * tool's output is not a convention anything else follows.
 */
const LEGACY_ERROR_TOOLS = new Set([
  'list_dir',
  'read_file',
  'write_file',
  'edit_file',
  'search_files',
]);

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
    return {
      kind: 'refused',
      label: approval.note === 'timeout' ? 'not approved in time' : 'refused',
      message,
    };
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

  if (LEGACY_ERROR_TOOLS.has(toolName) && output.startsWith('error: ')) {
    const message = output.slice('error: '.length);
    return {
      kind: 'failed',
      label: /permission denied|errno 13/i.test(message) ? 'permission denied' : 'failed',
      message,
    };
  }

  return null;
}
