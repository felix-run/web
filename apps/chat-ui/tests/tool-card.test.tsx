/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A `spec.shell_tools` result on the tool card.
 *
 * The harness returns one JSON object — argv, exit code, the tail of each
 * stream, whether either was cut — and the card drew it as that object: the exit
 * code between `"cwd"` and `"timed_out"` in the same grey as everything else,
 * and the reason a gate failed as a `\n`-escaped string inside a string. The
 * result is recognised by shape, not by tool name, because the name is whatever
 * the manifest called it.
 */

afterEach(cleanup);
beforeEach(() => {
  vi.resetModules();
  vi.doMock('../src/api', () => ({ getArtifact: vi.fn() }));
});

const shell = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    argv: ['uv', 'run', 'ruff', 'check'],
    cwd: '.',
    exit_code: 0,
    timed_out: false,
    output_exceeded: false,
    stdout: 'All checks passed!',
    stderr: '',
    truncated: false,
    duration_ms: 1840,
    ...over,
  });

describe('parseShellResult', () => {
  it('recognises the harness shape and nothing else', async () => {
    const { parseShellResult } = await import('../src/components/chat/tool');
    expect(parseShellResult(shell())).toMatchObject({ exit_code: 0, stdout: 'All checks passed!' });
    expect(parseShellResult('42 lines')).toBeNull();
    expect(parseShellResult('{"not":"a shell result"}')).toBeNull();
    // A spilled result ends in an artifact marker and is not JSON any more.
    expect(parseShellResult(`${shell()}\n\n[artifact:abc key=x chars=9]`)).toBeNull();
  });
});

describe('the tool card for a shell result', () => {
  it('leads with the exit status and draws the streams as streams', async () => {
    const { Tool } = await import('../src/components/chat/tool');
    render(<Tool tool={{ name: 'run', done: true, output: shell() }} verbose />);

    // Twice on purpose: once as the card's badge, where `done` used to be, and
    // once at the head of the expanded result.
    expect(screen.getAllByText('exit 0')).toHaveLength(2);
    expect(screen.getByText(/\$ uv run ruff check/)).toBeTruthy();
    expect(screen.getByText('All checks passed!')).toBeTruthy();
    expect(screen.getByText(/1\.8s/)).toBeTruthy();
    // No raw JSON: the object is chrome now, not output.
    expect(screen.queryByText(/"exit_code"/)).toBeNull();
    // Empty stderr is the normal case and says nothing.
    expect(screen.queryByText(/stderr/)).toBeNull();
  });

  it('marks a non-zero exit as failed and shows what stderr said', async () => {
    const { Tool } = await import('../src/components/chat/tool');
    render(
      <Tool
        tool={{
          name: 'run',
          done: true,
          output: shell({
            exit_code: 1,
            stdout: '',
            stderr: 'E501 line too long',
            truncated: true,
          }),
        }}
        verbose
      />,
    );

    for (const exit of screen.getAllByText('exit 1')) {
      expect(exit.className).toMatch(/text-state-failed/);
    }
    expect(screen.getByText('E501 line too long')).toBeTruthy();
    expect(screen.getByText(/stdout: nothing/)).toBeTruthy();
    expect(screen.getByText(/Cut to the tail/)).toBeTruthy();
  });

  it('says timed out rather than reporting an exit code it does not have', async () => {
    const { Tool } = await import('../src/components/chat/tool');
    render(
      <Tool
        tool={{ name: 'run', done: true, output: shell({ exit_code: null, timed_out: true }) }}
        verbose
      />,
    );
    expect(screen.getAllByText('timed out')).toHaveLength(2);
    expect(screen.queryByText(/^exit /)).toBeNull();
  });

  it('leaves an ordinary tool result exactly as it was', async () => {
    const { Tool } = await import('../src/components/chat/tool');
    render(<Tool tool={{ name: 'read_file', done: true, output: '42 lines' }} verbose />);
    expect(screen.getByText('done')).toBeTruthy();
    expect(screen.getByText('42 lines')).toBeTruthy();
  });
});
