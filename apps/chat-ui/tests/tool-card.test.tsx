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
    // Twice as well: the collapsed header's duration, and the expanded result's.
    expect(screen.getAllByText('1.8s')).toHaveLength(2);
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

/**
 * A gated call the harness refused.
 *
 * The result is a marker for the model, `[approval timeout] tool=write_file
 * rule=workspace-write`, and the card drew it as output under a `done` badge:
 * a tool that ran and printed a bracket. What actually happened is that nobody
 * approved it in time, which is the sentence the operator needs.
 */
describe('the tool card for a refused gate', () => {
  it('says nobody approved it, not that it ran', async () => {
    const { Tool } = await import('../src/components/chat/tool');
    render(
      <Tool
        tool={{
          name: 'write_file',
          done: true,
          input: { path: 'notes/todo.md' },
          output: '[approval timeout] tool=write_file rule=workspace-write',
        }}
        verbose
      />,
    );
    expect(screen.getByText('not approved in time')).toBeTruthy();
    expect(screen.getByText(/nobody approved write_file/)).toBeTruthy();
    expect(screen.queryByText('done')).toBeNull();
    expect(screen.queryByText(/\[approval timeout\]/)).toBeNull();
  });

  it('carries the refuser\x27s note when someone said no', async () => {
    const { Tool } = await import('../src/components/chat/tool');
    render(
      <Tool
        tool={{ name: 'local_shell', done: true, output: '[approval denied] tool=local_shell' }}
        verbose
      />,
    );
    expect(screen.getByText('refused')).toBeTruthy();
    expect(screen.getByText(/local_shell was denied/)).toBeTruthy();
  });
});

/**
 * A finished call that failed is not `done`.
 *
 * On the reference deployment an approved `write_file` failed with `Errno 13` and the card drew
 * the raw error under a green `done` badge. The harness marks a failure with a
 * `[tool error/<code>]` prefix; an older one returned workspace failures as bare `error: …`.
 */
describe('the tool card for a failed call', () => {
  it('names a structured tool error, not done', async () => {
    const { Tool } = await import('../src/components/chat/tool');
    render(
      <Tool
        tool={{
          name: 'write_file',
          done: true,
          input: { path: 'a.txt' },
          output:
            "[tool error/permission_denied] PermissionError: [Errno 13] Permission denied: '/workspace/a.txt'",
        }}
        verbose
      />,
    );
    expect(screen.getByText('permission denied')).toBeTruthy();
    expect(screen.getByText(/PermissionError: \[Errno 13\] Permission denied/)).toBeTruthy();
    expect(screen.queryByText('done')).toBeNull();
    expect(screen.queryByText(/\[tool error\//)).toBeNull();
  });

  it('reads the older workspace spelling that production still sends', async () => {
    const { Tool } = await import('../src/components/chat/tool');
    render(
      <Tool
        tool={{
          name: 'write_file',
          done: true,
          output: "error: [Errno 13] Permission denied: '/workspace/a.txt'",
        }}
        verbose
      />,
    );
    expect(screen.getByText('permission denied')).toBeTruthy();
    expect(screen.queryByText('done')).toBeNull();
  });

  it('leaves an ordinary tool whose output happens to start with "error:" alone', async () => {
    const { Tool } = await import('../src/components/chat/tool');
    render(
      <Tool tool={{ name: 'calculator', done: true, output: 'error: division by zero' }} verbose />,
    );
    expect(screen.getByText('done')).toBeTruthy();
  });
});

/**
 * The collapsed header reads `name · target · duration`.
 *
 * It read a wrench and the name, so five `read_file` cards were five identical
 * rows and the file each one read was one click away on every one of them.
 */
describe('the tool card header', () => {
  it('names what the call acted on without being opened', async () => {
    const { Tool } = await import('../src/components/chat/tool');
    render(<Tool tool={{ name: 'read_file', done: true, input: { path: 'src/a.ts' } }} />);
    const trigger = screen.getByRole('button');
    expect(trigger.textContent).toContain('read_file');
    expect(trigger.textContent).toContain('src/a.ts');
    expect(trigger.textContent).toContain('done');
  });

  it('uses the approval card\x27s sentence for a known client tool', async () => {
    const { Tool } = await import('../src/components/chat/tool');
    render(
      <Tool
        tool={{ name: 'write_file', done: false, input: { path: 'notes.md', content: 'hi' } }}
      />,
    );
    expect(screen.getByRole('button').textContent).toContain('Write notes.md (2 chars)');
  });

  it('shows a duration only when the harness reported one', async () => {
    const { Tool } = await import('../src/components/chat/tool');
    render(<Tool tool={{ name: 'read_file', done: true, input: { path: 'a' }, output: 'x' }} />);
    expect(screen.getByRole('button').textContent).not.toMatch(/\d(ms|s)\b/);
  });
});

describe('toolTarget', () => {
  it('reads a JSON-string input, falls back to key=value, and says nothing for no args', async () => {
    const { toolTarget } = await import('../src/components/chat/tool');
    expect(toolTarget('search', '{"query":"TODO"}')).toBe('TODO');
    expect(toolTarget('calc', { a: 1, b: 2 })).toBe('a=1 · b=2');
    expect(toolTarget('list_dir', {})).toBeNull();
    expect(toolTarget('list_dir', undefined)).toBeNull();
    expect(toolTarget('local_shell', { command: 'ls\n-la' })).toBe('Shell: ls -la');
  });

  /**
   * The case that made the fallback worth replacing: every GitHub call opens with
   * `owner` and `repo`, so compact JSON truncated two different questions to one
   * identical header.
   */
  it('tells two calls to the same MCP tool apart', async () => {
    const { toolTarget } = await import('../src/components/chat/tool');
    const bugs = toolTarget('github__list_issues', {
      owner: 'felix-run',
      repo: 'felix',
      state: 'open',
      labels: ['bug'],
      per_page: 30,
    });
    const closed = toolTarget('github__list_issues', {
      owner: 'felix-run',
      repo: 'felix',
      state: 'closed',
      per_page: 30,
    });
    expect(bugs).toBe('felix-run/felix · labels=bug');
    expect(closed).toBe('felix-run/felix · state=closed');
  });

  it('writes an issue or pull request as owner/repo#number', async () => {
    const { toolTarget } = await import('../src/components/chat/tool');
    expect(
      toolTarget('github__get_issue', { owner: 'felix-run', repo: 'felix', issue_number: 232 }),
    ).toBe('felix-run/felix#232');
    expect(
      toolTarget('github__get_pull_request', { owner: 'o', repo: 'r', pull_number: '12' }),
    ).toBe('o/r#12');
  });

  it('keeps compact JSON for arguments that are nothing but paging', async () => {
    const { toolTarget } = await import('../src/components/chat/tool');
    expect(toolTarget('mcp__list', { page: 2 })).toBe('{"page":2}');
  });
});

describe('the tool card output pane', () => {
  it('pretty-prints output that parses as JSON, and wraps rather than scrolling sideways', async () => {
    const { Tool } = await import('../src/components/chat/tool');
    render(
      <Tool
        tool={{ name: 'github__get_issue', done: true, output: '{"number":232,"state":"open"}' }}
        verbose
      />,
    );
    const pre = screen.getByText(/"number": 232/).closest('pre') as HTMLElement;
    expect(pre.textContent).toBe('{\n  "number": 232,\n  "state": "open"\n}');
    expect(pre.className).toContain('whitespace-pre-wrap');
  });

  it('leaves output that only starts with a brace exactly as sent', async () => {
    const { Tool } = await import('../src/components/chat/tool');
    render(<Tool tool={{ name: 'grep', done: true, output: '{ not json' }} verbose />);
    expect(screen.getByText('{ not json')).toBeTruthy();
  });
});
