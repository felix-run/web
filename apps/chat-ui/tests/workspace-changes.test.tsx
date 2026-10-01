// @vitest-environment happy-dom
import type { ApprovalRequest, ToolCall, Turn } from '@felix/client';
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceZone } from '../src/components/workspace/workspace-zone';
import { collectChanges, countLines, durableRunInFlight } from '../src/lib/changes';
import { ShellProvider, type ShellValue } from '../src/shell-context';

/**
 * "Changes on this thread": what each workspace path had done to it, claimed
 * only as far as the call proves. The rules worth pinning are the ones a tidier
 * list would break — a write is not a diff, a failed write is not a change, and
 * a durable run's empty list is the run loop, not an empty thread.
 */

vi.mock('../src/lib/cowork', () => ({
  getMountLabel: () => null,
  hasMount: () => false,
  mountTree: async () => [],
  vfs: { tree: () => [] },
  restoreMount: async () => ({ status: 'none' }),
  reconnectMount: async () => null,
  pickDirectory: async () => 'picked',
  clearMount: () => {},
  supportsDirectoryPicker: () => true,
}));

function call(
  name: string,
  input: Record<string, unknown>,
  output?: unknown,
  done = true,
): ToolCall {
  return { name, input, output, done };
}

function assistant(tools: ToolCall[], extra: Partial<Turn> = {}): Turn {
  return { id: `a-${Math.random()}`, role: 'assistant', content: '', tools, ...extra };
}

const OK_WRITE = JSON.stringify({ path: 'x', bytes: 1, append: false });

describe('collectChanges', () => {
  it('counts an edit from its old and new strings', () => {
    const [row] = collectChanges([
      assistant([
        call(
          'edit_file',
          { path: 'src/a.ts', old_string: 'one\ntwo\n', new_string: 'one\n2\nthree\n' },
          JSON.stringify({ path: 'src/a.ts', replacements: 1, bytes: 10 }),
        ),
      ]),
    ]);
    expect(row?.stat).toEqual({ text: '+3 −2', tone: 'count' });
    expect(row?.changed).toBe(true);
  });

  it('multiplies by the replacements the result reports for replace_all', () => {
    const [row] = collectChanges([
      assistant([
        call(
          'edit_file',
          { path: 'a.ts', old_string: 'x', new_string: 'y\nz', replace_all: true },
          JSON.stringify({ path: 'a.ts', replacements: 3, bytes: 10 }),
        ),
      ]),
    ]);
    expect(row?.stat.text).toBe('+6 −3');
  });

  it('says a whole-file write was written, and never draws a minus for it', () => {
    const [row] = collectChanges([
      assistant([call('write_file', { path: 'notes.txt', content: 'a\nb\nc' }, OK_WRITE)]),
    ]);
    expect(row?.stat.text).toBe('+3 written');
    expect(row?.stat.text).not.toContain('−');
  });

  it('reads a write then a later edit oldest first, and drops edits the write replaced', () => {
    const [row] = collectChanges([
      assistant([
        call('edit_file', { path: 'a.md', old_string: 'q', new_string: 'r' }, '{}'),
        call('write_file', { path: 'a.md', content: 'one\ntwo' }, OK_WRITE),
        call('edit_file', { path: 'a.md', old_string: 'one', new_string: '1\n1' }, '{}'),
      ]),
    ]);
    expect(row?.stat.text).toBe('+2 written · +2 −1');
  });

  it('does not count a failed write as a change', () => {
    const [row] = collectChanges([
      assistant([
        call(
          'write_file',
          { path: 'locked.txt', content: 'hi' },
          '[tool error/permission_denied] PermissionError: [Errno 13] Permission denied',
        ),
      ]),
    ]);
    expect(row?.changed).toBe(false);
    // The tool card's word for the same call, not a generic one beside it.
    expect(row?.stat).toEqual({ text: 'permission denied', tone: 'failed' });
    expect(row?.evidence?.issue).toContain('Permission denied');
  });

  it('reports a refused edit in the words the tool card uses', () => {
    const [row] = collectChanges([
      assistant([
        call('edit_file', { path: 'a', old_string: 'x', new_string: 'y' }, '[policy deny] nope'),
      ]),
    ]);
    expect(row?.stat).toEqual({ text: 'refused by policy', tone: 'failed' });
  });

  it('says a call in flight is in flight', () => {
    const [row] = collectChanges([
      assistant([call('write_file', { path: 'a', content: 'x' }, undefined, false)]),
    ]);
    expect(row?.stat).toEqual({ text: 'writing…', tone: 'pending' });
  });

  it('sorts writes above reads, each group newest first', () => {
    const rows = collectChanges([
      assistant([
        call('write_file', { path: 'old-write.txt', content: 'x' }, OK_WRITE),
        call('read_file', { path: 'read-1.txt' }, '{}'),
        call('edit_file', { path: 'new-edit.txt', old_string: 'a', new_string: 'b' }, '{}'),
        call('read_file', { path: 'read-2.txt' }, '{}'),
      ]),
    ]);
    expect(rows.map((r) => r.path)).toEqual([
      'new-edit.txt',
      'old-write.txt',
      'read-2.txt',
      'read-1.txt',
    ]);
  });

  it('names reads by verb and counts repeats, ignoring the ones that failed', () => {
    const [row] = collectChanges([
      assistant([
        call('read_file', { path: 'a' }, '{}'),
        call('client · read_file', { path: 'a' }, '{}'),
        call('read_file', { path: 'a' }, 'error: no such file'),
        call('read_file', { path: 'a' }, '{}'),
      ]),
    ]);
    expect(row?.stat.text).toBe('read ×3');
    expect(row?.evidence).toBeNull();
  });

  it('takes only an allowlisted path argument, never a mention', () => {
    const rows = collectChanges([
      assistant([
        call('github__create_pull_request', { body: 'touches ./scripts/test.sh', path: 'x' }, '{}'),
      ]),
    ]);
    expect(rows).toEqual([]);
  });

  it('counts lines the way an editor numbers them', () => {
    expect(countLines('')).toBe(0);
    expect(countLines('a')).toBe(1);
    expect(countLines('a\n')).toBe(1);
    expect(countLines('a\nb')).toBe(2);
  });

  it('treats a durable run as in flight only while streaming with a status turn last', () => {
    const status = assistant([], { runStatus: 'running' });
    expect(durableRunInFlight([status], true)).toBe(true);
    expect(durableRunInFlight([status], false)).toBe(false);
    expect(durableRunInFlight([assistant([])], true)).toBe(false);
  });
});

function approval(id: string, threadId?: string): ApprovalRequest {
  return {
    id,
    tool_name: 'write_file',
    status: 'pending',
    ...(threadId === undefined ? {} : { thread_id: threadId }),
  } as ApprovalRequest;
}

function mount({
  turns = [],
  streaming = false,
  pending = [],
}: {
  turns?: Turn[];
  streaming?: boolean;
  pending?: ApprovalRequest[];
}) {
  const value = {
    turns,
    threads: [],
    threadId: 'here',
    streaming,
    selectThread: () => {},
    newThread: () => {},
    deleteThread: () => {},
    renameThread: () => {},
    forkThread: () => {},
    compactThread: () => {},
    exportThread: () => {},
    tenantApprovals: {
      pending,
      error: null,
      lastOkAt: Date.now(),
      failures: 0,
      refresh: () => {},
      markDecided: () => {},
    },
  } as unknown as ShellValue;
  return render(
    <TooltipProvider>
      <ShellProvider value={value}>
        <WorkspaceZone />
      </ShellProvider>
    </TooltipProvider>,
  );
}

afterEach(() => cleanup());

describe('the Changes section', () => {
  it('is absent on a thread with no workspace calls and no run', () => {
    mount({});
    expect(screen.queryByRole('region', { name: 'Changes on this thread' })).toBeNull();
  });

  it('says changes are coming while a durable run is in flight', () => {
    mount({
      streaming: true,
      turns: [
        { id: 'u', role: 'user', content: 'go' },
        assistant([], { content: 'Background · running…', runStatus: 'running' }),
      ],
    });
    const section = screen.getByRole('region', { name: 'Changes on this thread' });
    expect(section.textContent).toContain('Changes appear when the run finishes.');
  });

  it('drops the durable line once the run has reported a tool call', () => {
    mount({
      streaming: true,
      turns: [
        { id: 'u', role: 'user', content: 'go' },
        assistant([call('read_file', { path: 'a.txt' }, '{}')]),
        assistant([], { content: 'Background · running…', runStatus: 'running' }),
      ],
    });
    const section = screen.getByRole('region', { name: 'Changes on this thread' });
    expect(section.textContent).not.toContain('Changes appear');
    expect(section.textContent).toContain('a.txt');
  });

  it('opens a write row from the keyboard to show what was written', async () => {
    mount({
      turns: [
        assistant([
          call('write_file', { path: 'docs/notes.md', content: 'hello there' }, OK_WRITE),
        ]),
      ],
    });
    const row = screen.getByRole('button', { name: /notes\.md/ });
    expect(row.getAttribute('aria-expanded')).toBe('false');
    expect(row.textContent).toContain('+1 written');
    expect(row.getAttribute('title')).toBe('docs/notes.md');
    row.focus();
    await userEvent.keyboard('{Enter}');
    expect(row.getAttribute('aria-expanded')).toBe('true');
    const panel = document.getElementById(row.getAttribute('aria-controls') ?? '');
    expect(panel?.textContent).toContain('Written');
    expect(panel?.textContent).toContain('hello there');
    await userEvent.keyboard(' ');
    expect(row.getAttribute('aria-expanded')).toBe('false');
  });

  it('draws a failed write as the word failed, in the failure colour', () => {
    mount({
      turns: [
        assistant([
          call(
            'write_file',
            { path: 'x.txt', content: 'a' },
            '[tool error/internal] OSError: boom',
          ),
        ]),
      ],
    });
    const stat = screen.getByText('failed');
    expect(stat.className).toContain('text-state-failed');
  });

  /**
   * Files is this tab's store and Changes is every workspace call on the thread,
   * so a harness-side write lands in the second and never the first. The empty
   * store says which store it is rather than "Nothing written yet" under a
   * `+1 written` row.
   */
  it("says the tab's store is empty because the writes ran on the harness", async () => {
    mount({
      turns: [assistant([call('write_file', { path: 'notes.md', content: 'hi' }, OK_WRITE)])],
    });
    expect(await screen.findByText(/The writes above ran on the harness/)).toBeTruthy();
    expect(screen.queryByText('Nothing written yet.')).toBeNull();
  });

  it('never labels a call that was not applied as written', async () => {
    mount({
      turns: [
        assistant([
          call(
            'write_file',
            { path: 'x.txt', content: 'a' },
            '[tool error/internal] OSError: boom',
          ),
        ]),
      ],
    });
    await userEvent.click(screen.getByRole('button', { name: /x\.txt/ }));
    const row = screen.getByRole('button', { name: /x\.txt/ });
    const panel = document.getElementById(row.getAttribute('aria-controls') ?? '');
    expect(panel?.textContent).toContain('Not applied');
    expect(panel?.textContent).toContain('Would have written');
    expect(panel?.textContent).not.toMatch(/(^|[^ ])Written/);
  });
});

describe('the thread trigger', () => {
  function trigger() {
    return screen.getByRole('button', { name: /New thread/ });
  }

  it('counts approvals waiting on other threads only', () => {
    mount({
      pending: [
        approval('1', 'elsewhere'),
        approval('2', 'here'),
        approval('3'),
        approval('4', ''),
      ],
    });
    const t = trigger();
    expect(within(t).getByText('1 approval waiting on another thread')).toBeTruthy();
    expect(t.textContent).toContain('1 waiting');
  });

  it('pluralises, and says nothing when only this thread and unattributed rows wait', () => {
    cleanup();
    mount({ pending: [approval('1', 'a'), approval('2', 'b')] });
    expect(within(trigger()).getByText('2 approvals waiting on other threads')).toBeTruthy();
    cleanup();
    mount({ pending: [approval('1', 'here'), approval('2')] });
    expect(trigger().textContent).not.toContain('waiting');
  });
});
