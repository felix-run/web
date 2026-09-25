import { describe, expect, it } from 'vitest';
import { classifyToolResult } from '../src/tool-results';

/**
 * A finished call is not the same as a successful one.
 *
 * On the reference deployment an approved `write_file` failed with `Errno 13` and its card said
 * `done`. These pin every spelling the harness gives a failure or a refusal, and the two ways a
 * classifier could over-reach: a marker quoted mid-text, and `error:` from a tool that never
 * used that convention.
 */
describe('classifyToolResult', () => {
  it('reads a structured tool error and its code', () => {
    expect(
      classifyToolResult(
        'write_file',
        "[tool error/permission_denied] PermissionError: [Errno 13] Permission denied: '/workspace/a.txt'",
      ),
    ).toEqual({
      kind: 'failed',
      label: 'permission denied',
      message: "PermissionError: [Errno 13] Permission denied: '/workspace/a.txt'",
      code: 'permission_denied',
    });
    expect(
      classifyToolResult(
        'edit_file',
        '[tool error/invalid_arguments] old_string not found in a.txt',
      ),
    ).toMatchObject({
      kind: 'failed',
      label: 'invalid arguments',
    });
    expect(classifyToolResult('x', '[tool error/something_new] boom')).toMatchObject({
      label: 'failed',
    });
  });

  it('reads the runner errors and the control refusals', () => {
    expect(classifyToolResult('x', '[error/RuntimeError] exploded')).toMatchObject({
      kind: 'failed',
      message: 'exploded',
    });
    expect(classifyToolResult('x', '[fatal/Crash] down')).toMatchObject({ kind: 'failed' });
    expect(classifyToolResult('x', '[policy needs-scope] missing tools:x')).toMatchObject({
      kind: 'refused',
      label: 'refused by policy',
    });
    expect(classifyToolResult('x', '[limits] max_tool_calls reached')).toMatchObject({
      kind: 'refused',
      label: 'refused by limits',
    });
  });

  it('keeps the approval outcomes, and a waiting gate is not a refusal', () => {
    expect(
      classifyToolResult('write_file', '[approval timeout] tool=write_file rule=workspace-write'),
    ).toMatchObject({
      kind: 'refused',
      label: 'not approved in time',
    });
    expect(
      classifyToolResult('write_file', '[approval required] tool=write_file rule=r'),
    ).toBeNull();
  });

  it('honours the old workspace spelling, and only for workspace tools', () => {
    expect(
      classifyToolResult('write_file', "error: [Errno 13] Permission denied: '/workspace/a.txt'"),
    ).toMatchObject({ kind: 'failed', label: 'permission denied' });
    expect(classifyToolResult('read_file', 'error: not a file: a.txt')).toMatchObject({
      label: 'failed',
    });
    // `error:` from a tool that never used the convention is output, not a verdict.
    expect(classifyToolResult('calculator', 'error: the expression was 1/0')).toBeNull();
  });

  it('reads only the start, and leaves success alone', () => {
    expect(classifyToolResult('x', 'the log said [tool error/timeout] once')).toBeNull();
    expect(classifyToolResult('write_file', '{"path": "a.txt", "bytes": 25}')).toBeNull();
    expect(classifyToolResult('x', { ok: true })).toBeNull();
  });
});
