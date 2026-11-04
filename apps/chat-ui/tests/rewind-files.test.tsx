// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { toast } from 'sonner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';

/**
 * Every rewind settles the branch it leaves, so whether files go back is asked before it and
 * only then. The real `App` over a stubbed `fetch`: what is pinned is the request.
 */

const SNAPSHOT = (tool: string) => ({
  id: 'rw',
  phase: 'idle',
  transcript: [
    { id: 'e1', seq: 0, kind: 'message', role: 'user', content: 'first' },
    {
      id: 'e2',
      seq: 1,
      kind: 'message',
      role: 'assistant',
      content: 'reply one',
      metadata: { parent_id: 'e1' },
    },
    {
      id: 'e3',
      seq: 2,
      kind: 'message',
      role: 'user',
      content: 'second',
      metadata: { parent_id: 'e2' },
    },
    {
      id: 'e4',
      seq: 3,
      kind: 'message',
      role: 'assistant',
      content: '',
      toolCalls: [{ id: 'c1', name: tool, args: { path: 'notes.md' } }],
      metadata: { parent_id: 'e3' },
    },
    {
      id: 'e5',
      seq: 4,
      kind: 'tool_result',
      role: 'tool',
      toolName: tool,
      toolCallId: 'c1',
      content: 'wrote notes.md',
      metadata: { parent_id: 'e4' },
    },
    {
      id: 'e6',
      seq: 5,
      kind: 'message',
      role: 'assistant',
      content: 'done',
      metadata: { parent_id: 'e5' },
    },
  ],
  leafId: 'e6',
});

function stub(opts: { tool?: string; scope?: string; rewind?: unknown } = {}) {
  const rewinds: Record<string, unknown>[] = [];
  localStorage.setItem('felix.manifest', 'files-agent');
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/v1/models')) {
        const felix = { workspace: { tools: 'server', scope: opts.scope ?? 'thread' } };
        return Response.json({ object: 'list', data: [{ id: 'files-agent', felix }] });
      }
      if (url.includes('/chat/rewind')) {
        rewinds.push(JSON.parse(String(init?.body)));
        return Response.json(opts.rewind ?? { ok: true, leaf_id: 'e2' });
      }
      if (/\/chat\/sessions\/rw(\?|$)/.test(url)) {
        return Response.json(SNAPSHOT(opts.tool ?? 'write_file'));
      }
      return Response.json({ sessions: [], items: [], requests: [], events: [] });
    }),
  );
  return rewinds;
}

async function rewind() {
  render(
    <MemoryRouter initialEntries={['/t/rw']}>
      <ThemeProvider>
        <TooltipProvider>
          <App />
        </TooltipProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
  await screen.findByText('reply one');
  const buttons = await screen.findAllByRole('button', {
    name: 'Rewind the thread to this message',
  });
  await userEvent.click(buttons[0] as HTMLElement);
}

/** What the last toast said, and what it offered; the toaster itself is not mounted here. */
const toasted = () => vi.mocked(toast.message).mock.lastCall;

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(toast, 'message');
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('rewinding past an agent writing a file', () => {
  it('asks first, and sends nothing until answered', async () => {
    const rewinds = stub();
    await rewind();
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(rewinds).toEqual([]);
  });

  it('restores when told to, and says what it left alone', async () => {
    const rewinds = stub({
      rewind: { ok: true, files: { restored: ['notes.md'], conflicts: ['README.md'] } },
    });
    await rewind();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Put it back' }));
    await waitFor(() => expect(rewinds.length).toBe(1));
    expect(rewinds[0]).toMatchObject({ event_id: 'e1', restore_files: true });
    await waitFor(() => expect(toasted()?.[0]).toContain('Put back 1 file.'));
    const options = toasted()?.[1];
    expect(options?.description).toContain('changed since: README.md');
    // What it left undone is what someone has to act on, so it stays until dismissed.
    expect(options?.duration).toBe(Number.POSITIVE_INFINITY);
    expect(options?.action).toBeUndefined();
  });

  it('keeps the files without the flag, and still offers Undo', async () => {
    const rewinds = stub();
    await rewind();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep it' }));
    await waitFor(() => expect(rewinds.length).toBe(1));
    expect(rewinds[0]).not.toHaveProperty('restore_files');
    await waitFor(() => expect(toasted()?.[1]?.action).toMatchObject({ label: 'Undo' }));
  });

  it('moves nothing on Cancel', async () => {
    const rewinds = stub();
    await rewind();
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(rewinds).toEqual([]);
  });
});

describe('a rewind with nothing to ask', () => {
  it.each([
    ['no recorded tool ran', { tool: 'read_file' }],
    ['the workspace is shared across threads', { scope: 'tenant' }],
  ])('goes straight through when %s', async (_why, opts) => {
    const rewinds = stub(opts);
    await rewind();
    await waitFor(() => expect(rewinds.length).toBe(1));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(rewinds[0]).not.toHaveProperty('restore_files');
  });
});
