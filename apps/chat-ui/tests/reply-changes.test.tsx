// @vitest-environment happy-dom
import type { ToolCall, Turn } from '@felix/client';
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';
import { ReplyChanges } from '../src/components/workspace/changes-list';
import { changesByReply, collectChanges, countChangedFiles } from '../src/lib/changes';
import { openInPane, paneState, resetPanes } from '../src/lib/side-pane';
import { ShellProvider, type ShellValue } from '../src/shell-context';

/**
 * "N files changed · Review" under a reply. The everyday surface has no run
 * instrument, so this line is where it says what a reply did to the workspace —
 * counted only from calls that landed, once per reply, and opening the reply's
 * own changes in the side pane rather than the whole thread's.
 */

const OK_WRITE = JSON.stringify({ path: 'x', bytes: 1, append: false });
const DENIED = '[approval denied] tool=write_file rule=workspace-write';
const call = (name: string, input: Record<string, unknown>, output?: unknown): ToolCall => ({
  name,
  input,
  output,
  done: true,
});
const user = (content: string): Turn => ({ id: `u-${content}`, role: 'user', content });
const assistant = (tools: ToolCall[], content = ''): Turn => ({
  id: `a-${Math.random()}`,
  role: 'assistant',
  content,
  tools,
});

afterEach(() => {
  cleanup();
  resetPanes();
});

describe('changesByReply', () => {
  const turns: Turn[] = [
    user('write notes'),
    assistant([call('write_file', { path: 'notes.md', content: 'x' }, OK_WRITE)]),
    assistant([], 'Done.'),
    user('read it back'),
    assistant([call('read_file', { path: 'notes.md' }, 'x')], 'It says x.'),
    user('tidy up'),
    assistant([
      call(
        'client · local_rename',
        { path: 'a.md', to_path: 'docs/a.md' },
        JSON.stringify({ path: 'a.md', to_path: 'docs/a.md' }),
      ),
      call('write_file', { path: 'secret.env', content: 'k' }, DENIED),
    ]),
  ];

  it('puts each reply under its last assistant turn, and skips one that only read', () => {
    const replies = changesByReply(turns);
    expect([...replies.keys()]).toEqual([2, 6]);
    expect(replies.get(2)).toEqual({ from: 1, to: 2, files: 1 });
  });

  it('counts a rename once and a denied write not at all', () => {
    expect(changesByReply(turns).get(6)?.files).toBe(1);
    expect(countChangedFiles(collectChanges(turns.slice(6)))).toBe(1);
  });
});

function mount(turns: Turn[], from: number, to: number) {
  const value = { turns, threads: [], threadId: 'here', streaming: false } as unknown as ShellValue;
  return render(
    <TooltipProvider>
      <ShellProvider value={value}>
        <ReplyChanges from={from} to={to} />
      </ShellProvider>
    </TooltipProvider>,
  );
}

describe('the reply’s changes in the pane', () => {
  const turns: Turn[] = [
    user('first'),
    assistant([call('write_file', { path: 'one.md', content: 'x' }, OK_WRITE)]),
    user('second ask'),
    assistant([call('write_file', { path: 'two.md', content: 'x' }, OK_WRITE)]),
  ];

  it('lists only that reply’s paths, under the message it answered', () => {
    mount(turns, 3, 3);
    expect(screen.getByText('second ask')).toBeTruthy();
    expect(screen.getByText('two.md')).toBeTruthy();
    expect(screen.queryByText('one.md')).toBeNull();
  });

  it('says so in its own words when the scope holds nothing', () => {
    mount(turns, 9, 9);
    expect(screen.getByText('Nothing in this reply touched a workspace file.')).toBeTruthy();
  });

  it('is one tab per thread, re-scoped by the next Review', () => {
    openInPane('t', { kind: 'changes', from: 1, to: 1 });
    openInPane('t', { kind: 'changes', from: 3, to: 3 });
    const items = paneState('t').items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'changes', from: 3, to: 3 });
  });
});

describe('the line under a reply, everyday', () => {
  const THREAD = 'reply-changes-thread';
  const snapshot = {
    id: `default:${THREAD}`,
    leafId: 'a3',
    transcript: [
      { id: 'u1', seq: 1, kind: 'message', role: 'user', content: 'write notes', metadata: {} },
      {
        id: 'a1',
        seq: 2,
        kind: 'message',
        role: 'assistant',
        content: 'Writing it now.',
        toolCalls: [{ id: 'c1', name: 'write_file', args: { path: 'notes.md', content: 'hi' } }],
        metadata: { parent_id: 'u1' },
      },
      {
        id: 't1',
        seq: 3,
        kind: 'tool_result',
        role: 'tool',
        content: OK_WRITE,
        toolCallId: 'c1',
        toolName: 'write_file',
        metadata: { parent_id: 'a1' },
      },
      {
        id: 'a2',
        seq: 4,
        kind: 'message',
        role: 'assistant',
        content: 'Done.',
        metadata: { parent_id: 't1' },
      },
      {
        id: 'u2',
        seq: 5,
        kind: 'message',
        role: 'user',
        content: 'thanks',
        metadata: { parent_id: 'a2' },
      },
      {
        id: 'a3',
        seq: 6,
        kind: 'message',
        role: 'assistant',
        content: 'Any time.',
        metadata: { parent_id: 'u2' },
      },
    ],
  };

  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    localStorage.setItem('felix.view', 'everyday');
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.endsWith(`/chat/sessions/${THREAD}`))
          return new Response(JSON.stringify(snapshot), { status: 200 });
        if (url.includes('/chat/sessions'))
          return new Response(JSON.stringify({ sessions: [], items: [] }), { status: 200 });
        if (url.includes('/approvals'))
          return new Response(JSON.stringify({ requests: [] }), { status: 200 });
        return new Response('{}', { status: 200 });
      }),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('is drawn once, under the reply’s last turn, and Review opens its changes', async () => {
    render(
      <MemoryRouter initialEntries={[`/t/${THREAD}`]}>
        <ThemeProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    const transcript = () => document.querySelector('[aria-label="Transcript"]') as HTMLElement;
    await waitFor(() => expect(transcript()?.textContent).toContain('Any time.'));

    const lines = transcript().querySelectorAll('[data-slot="reply-changes"]');
    expect(lines).toHaveLength(1);
    // Under "Done.", the second of the reply's two turns — not under the tool call.
    const row = lines[0]?.closest('[data-slot=message-scroller-item]');
    expect(row?.getAttribute('data-message-id')).toBe('turn-2');
    expect(lines[0]?.textContent).toContain('1 file changed');

    await userEvent.setup().click(screen.getByRole('button', { name: /Review the 1 file/ }));
    const pane = await waitFor(() => {
      const el = document.querySelector<HTMLElement>('[data-slot="side-pane"]');
      if (!el) throw new Error('no pane yet');
      return el;
    });
    expect(within(pane).getByRole('tab', { name: /Changes/ })).toBeTruthy();
    expect(within(pane).getByText('notes.md')).toBeTruthy();
    expect(paneState(THREAD).items[0]).toMatchObject({ kind: 'changes', from: 1, to: 2 });
  });
});
