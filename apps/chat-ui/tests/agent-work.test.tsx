// @vitest-environment happy-dom

import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { Message } from '../src/components/chat/message';
import { MultimodalInput } from '../src/components/chat/multimodal-input';
import { ThemeProvider } from '../src/components/theme-provider';
import type { ToolCall, Turn } from '../src/types';

/**
 * What the agent does beside its tool calls, drawn in the turn and the composer:
 * its checklist (`todo_write`) as one card, a `task` call as the child agent it
 * started, and a thread that is not in its default permission mode.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
});

const draw = (tools: ToolCall[], streaming = false) => {
  const turn: Turn = { id: 'a1', role: 'assistant', content: '', tools };
  render(
    <TooltipProvider>
      <Message turn={turn} streaming={streaming} />
    </TooltipProvider>,
  );
};

const LIST = [
  { content: 'Read the config', status: 'completed' },
  { content: 'Fix the parser', status: 'in_progress', active_form: 'Fixing the parser' },
  { content: 'Run the tests', status: 'pending' },
];

describe('the checklist', () => {
  it('is one card for the turn, at its first write, showing the newest list', () => {
    const write = (todos: unknown[], output: string): ToolCall => ({
      name: 'todo_write',
      input: { todos },
      output,
      done: true,
    });
    draw([
      write(LIST, 'Todo list updated: 1/3 completed.'),
      { name: 'read_file', input: { path: 'parser.ts' }, output: 'x', done: true },
      write(
        LIST.map((t) => ({ ...t, status: t.status === 'pending' ? 'pending' : 'completed' })),
        'Todo list updated: 2/3 completed.',
      ),
    ]);
    expect(document.querySelectorAll('[data-plan-id="checklist"]')).toHaveLength(1);
    expect(screen.getByText('Checklist')).toBeTruthy();
    expect(screen.getByText('2 of 3 done')).toBeTruthy();
    // The card stands for the writes; neither draws a tool card of its own.
    expect(screen.queryByText('todo_write')).toBeNull();
    expect(screen.getByText('read_file')).toBeTruthy();
  });

  it('reads the item under way as the agent said it would while doing it', () => {
    draw([
      {
        name: 'todo_write',
        input: { todos: LIST },
        done: false,
        todos: LIST.map((t, i) => ({
          id: String(i + 1),
          content: t.content,
          status: t.status as 'pending',
          activeForm: t.active_form ?? '',
        })),
      },
    ]);
    expect(screen.getByText('Fixing the parser')).toBeTruthy();
    expect(screen.getByText('now')).toBeTruthy();
  });

  it('leaves a refused write as the failed call it was', () => {
    draw([
      {
        name: 'todo_write',
        input: { todos: LIST },
        output: '[tool error/invalid_arguments] at most one item may be in_progress',
        done: true,
      },
    ]);
    expect(document.querySelector('[data-plan-id="checklist"]')).toBeNull();
    expect(screen.getByText('todo_write')).toBeTruthy();
  });
});

describe('a task call', () => {
  it('names the agent and its job, and works as that agent', () => {
    draw(
      [
        {
          name: 'task',
          input: { agent: 'researcher', prompt: 'Find the  migration\nnotes' },
          done: false,
          subagent: { agent: 'researcher', state: 'running' },
        },
      ],
      true,
    );
    expect(screen.getByText('researcher · Find the migration notes')).toBeTruthy();
    expect(screen.getByText('researcher working')).toBeTruthy();
  });

  it('says a background child is still going, not done', () => {
    draw([
      {
        name: 'task',
        input: { agent: 'researcher', prompt: 'go', background: true },
        output: "[task] agent 'researcher' is working in the background as task tok9. Call …",
        done: true,
      },
    ]);
    const badge = screen.getByText('in background');
    expect(badge.closest('[title]')?.getAttribute('title')).toBe('Task tok9');
    expect(screen.queryByText('done')).toBeNull();
  });

  const call = (n: number, done = true, result = 'ok') => ({
    callId: `r${n}`,
    name: 'read_file',
    input: { path: `notes/${n}.md` },
    done,
    ...(done ? { result } : {}),
  });

  it('shows the child’s calls under the card, outside the fold, the running one shimmering', () => {
    draw(
      [
        {
          name: 'task',
          input: { agent: 'researcher', prompt: 'go' },
          done: false,
          subagent: {
            agent: 'researcher',
            state: 'running',
            calls: [call(1), call(2, true, '[error/TimeoutError] took too long'), call(3, false)],
          },
        },
      ],
      true,
    );
    const lines = Array.from(document.querySelectorAll('[data-slot=subagent-call]'));
    expect(lines.map((l) => l.textContent)).toEqual([
      'read_filenotes/1.md',
      expect.stringMatching(/^read_filenotes\/2\.md.+/),
      'read_filenotes/3.md',
    ]);
    expect(lines.map((l) => l.getAttribute('data-status'))).toEqual([null, 'error', 'running']);
    // On the card itself, not inside its collapsed body.
    expect(lines[0]?.closest('[data-slot=collapsible-content]')).toBeNull();
  });

  it('folds all but the newest five calls into one line, and keeps them once the child is done', () => {
    draw([
      {
        name: 'task',
        input: { agent: 'researcher', prompt: 'go' },
        output: 'Found it.',
        done: true,
        subagent: {
          agent: 'researcher',
          state: 'ok',
          calls: [1, 2, 3, 4, 5, 6, 7].map((n) => call(n)),
        },
      },
    ]);
    expect(screen.getByText('2 earlier calls')).toBeTruthy();
    const visible = () =>
      Array.from(document.querySelectorAll('[data-slot=subagent-call]')).map((l) => l.textContent);
    expect(visible()).toEqual([3, 4, 5, 6, 7].map((n) => `read_filenotes/${n}.md`));
    fireEvent.click(screen.getByText('2 earlier calls'));
    expect(visible()).toHaveLength(7);
  });

  it('draws no lines for a task call the stream reported no calls for', () => {
    draw([
      {
        name: 'task',
        input: { agent: 'researcher', prompt: 'go' },
        output: 'Found it.',
        done: true,
      },
    ]);
    expect(document.querySelector('[data-slot=subagent-calls]')).toBeNull();
  });
});

describe('the permission mode in the composer', () => {
  const composer = (permissionMode: string | null, onLeave = vi.fn()) => {
    render(
      <TooltipProvider>
        <MultimodalInput
          status="ready"
          isConnected
          onSubmit={async () => {}}
          permissionMode={permissionMode}
          onLeavePermissionMode={onLeave}
        />
      </TooltipProvider>,
    );
    return onLeave;
  };

  it('is drawn only off the default, and one press leaves it', () => {
    const onLeave = composer('plan');
    const chip = screen.getByRole('button', { name: /Plan mode: read and propose only/ });
    expect(chip.getAttribute('aria-label')).toContain('Leave plan mode');
    fireEvent.click(chip);
    expect(onLeave).toHaveBeenCalledOnce();
  });

  it('draws nothing in the default mode', () => {
    composer(null);
    expect(screen.queryByRole('button', { name: /mode/i })).toBeNull();
  });

  it('marks a mode that waives every approval in the danger tone', () => {
    composer('bypass');
    const chip = screen.getByRole('button', { name: /Bypassing approvals/ });
    expect(chip.className).toContain('text-state-failed');
  });
});

describe('the permission mode, with the shell around it', () => {
  it('comes from the snapshot, and the chip posts the default back', async () => {
    const posts: Array<{ url: string; body: unknown }> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === 'POST') {
          posts.push({ url, body: init.body ? JSON.parse(String(init.body)) : undefined });
        }
        if (/\/chat\/sessions\/planned(\?|$)/.test(url)) {
          return Response.json({
            id: 'planned',
            phase: 'idle',
            transcript: [{ id: 'e1', seq: 0, kind: 'message', role: 'user', content: 'hi' }],
            permissionMode: 'plan',
          });
        }
        if (url.includes('/chat/mode')) return Response.json({ ok: true, mode: 'default' });
        return Response.json({ sessions: [], items: [], requests: [], events: [] });
      }),
    );
    render(
      <MemoryRouter initialEntries={['/t/planned']}>
        <ThemeProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    const chip = await screen.findByRole('button', { name: /Plan mode: read and propose only/ });
    await userEvent.click(chip);
    await waitFor(() =>
      expect(posts.find((p) => p.url.endsWith('/chat/mode'))?.body).toEqual({
        thread_id: 'planned',
        mode: 'default',
      }),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /Plan mode: read and propose only/ })).toBeNull(),
    );
  });
});
