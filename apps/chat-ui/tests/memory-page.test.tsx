/** @vitest-environment happy-dom */

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShellValue } from '../src/shell-context';
import type { MemoryHit, MemoryRecord } from '../src/types';

/**
 * The Memory page as a place to hunt a fact down.
 *
 * What is pinned is what the critique found it could not do: say which
 * conversation taught the agent a fact, scope "as of turn N" to one
 * conversation, report a forget that failed, and take a forget back.
 */

const HOUR = 3_600_000;
const now = Date.now();

const row = (over: Partial<MemoryRecord> & { id: string; content: string }): MemoryRecord => ({
  kind: 'task',
  manifest_id: 'cowork',
  status: 'active',
  importance: 0.6,
  origin_seq: 4,
  thread_id: 'default:thread-a',
  created_at: now - 2 * HOUR,
  last_used_at: null,
  embedding_dim: null,
  metadata: { source: 'capture' },
  ...over,
});

function api(over: Record<string, unknown> = {}) {
  const fns = {
    addMemory: vi.fn(),
    forgetMemory: vi.fn().mockResolvedValue(undefined),
    restoreMemory: vi.fn().mockResolvedValue(undefined),
    listMemories: vi.fn().mockResolvedValue([]),
    memoriesAsOf: vi.fn().mockResolvedValue([]),
    searchMemories: vi.fn().mockResolvedValue([]),
    ...over,
  };
  vi.doMock('../src/api', () => fns);
  return fns;
}

function Where() {
  const loc = useLocation();
  return <output data-testid="where">{loc.search}</output>;
}

async function mount(entry = '/harness/memory') {
  const { MemorySection } = await import('../src/components/harness/memory');
  const { PanelModeProvider } = await import('../src/components/inspector/primitives');
  const { ShellProvider } = await import('../src/shell-context');
  const shell = {
    threads: [{ id: 'thread-a', title: 'Release checklist', manifest: 'cowork', updatedAt: now }],
    manifest: 'cowork',
    manifestOptions: ['cowork', 'quick'],
  } as unknown as ShellValue;
  return render(
    <MemoryRouter initialEntries={[entry]}>
      <ShellProvider value={shell}>
        <PanelModeProvider>
          <MemorySection enabled open onToggle={() => {}} />
        </PanelModeProvider>
        <Where />
      </ShellProvider>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.doUnmock('../src/api');
  vi.resetModules();
});

describe('a memory says where it came from', () => {
  it('leads with the conversation, the turn, when it was written and whether it was recalled', async () => {
    api({
      listMemories: vi.fn().mockResolvedValue([row({ id: 'm1', content: 'Ship on Fridays.' })]),
    });
    await mount();
    const item = (await screen.findByText('Ship on Fridays.')).closest('li') as HTMLElement;
    // Named as a conversation, and drawn as one: "from", quoted, underlined.
    const thread = within(item).getByRole('link', { name: 'Conversation “Release checklist”' });
    expect(thread.getAttribute('href')).toBe('/t/thread-a');
    expect(thread.textContent).toBe('“Release checklist”');
    expect(thread.parentElement?.textContent).toMatch(/^from\s?“Release checklist”$/);
    expect(thread.className).toContain('underline');
    // The turn opens As of for that conversation at that turn.
    const turn = within(item).getByRole('link', { name: 'turn 4' });
    expect(turn.getAttribute('href')).toContain('view=asof');
    expect(turn.getAttribute('href')).toContain('thread=thread-a');
    expect(turn.getAttribute('href')).toContain('turn=4');
    expect(within(item).getByText('written 2h ago')).toBeTruthy();
    expect(within(item).getByText('never recalled')).toBeTruthy();
    // The harness's spelling, not its field names.
    expect(within(item).getByText('importance 0.6')).toBeTruthy();
    expect(within(item).queryByText(/imp 0\.60|seq 4/)).toBeNull();
  });

  it('says an operator added a row no conversation wrote', async () => {
    api({
      listMemories: vi.fn().mockResolvedValue([
        row({
          id: 'm2',
          content: 'Staging is :8081.',
          thread_id: '',
          origin_seq: null,
          metadata: { source: 'management_api' },
        }),
      ]),
    });
    await mount();
    expect(await screen.findByText('added by an operator')).toBeTruthy();
  });

  it('ranks a hit and names its retriever in the words Recent uses', async () => {
    const hit: MemoryHit = {
      id: 'h1',
      content: 'Ship on Fridays.',
      kind: 'task',
      score: 0.018,
      channels: ['fts'],
      thread_id: 'default:thread-a',
      origin_seq: 4,
      created_at: now - HOUR,
      last_used_at: now - HOUR,
    };
    api({ searchMemories: vi.fn().mockResolvedValue([hit]) });
    await mount('/harness/memory?view=search&q=ship');
    const item = (await screen.findByText('Ship on Fridays.')).closest('li') as HTMLElement;
    expect(within(item).getByText('#1').getAttribute('title')).toBe('Fused score 0.018');
    expect(within(item).getByText('via lexical')).toBeTruthy();
    expect(within(item).getByText('recalled 1h ago')).toBeTruthy();
    expect(
      within(item).getByRole('link', { name: 'Conversation “Release checklist”' }),
    ).toBeTruthy();
  });
});

describe('forgetting', () => {
  it('says so on the row when the forget fails, rather than leaving the confirm armed', async () => {
    api({
      listMemories: vi.fn().mockResolvedValue([row({ id: 'm1', content: 'Ship on Fridays.' })]),
      forgetMemory: vi.fn().mockRejectedValue(new Error('memory/forget: 403 missing scopes')),
    });
    await mount();
    fireEvent.click(await screen.findByRole('button', { name: /^Forget “/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Forget it' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/not allowed to forget this memory/);
  });

  it('quotes the fact it is about to lose with an ellipsis, not a cut word', async () => {
    const long = `${'word '.repeat(30)}end`;
    api({ listMemories: vi.fn().mockResolvedValue([row({ id: 'm1', content: long })]) });
    await mount();
    fireEvent.click(await screen.findByRole('button', { name: /^Forget “/ }));
    expect(screen.getByText(/…” will stop being recalled\./)).toBeTruthy();
  });

  it('offers Undo, which restores the memory', async () => {
    const fns = api({
      listMemories: vi.fn().mockResolvedValue([row({ id: 'm1', content: 'Ship on Fridays.' })]),
    });
    await mount();
    fireEvent.click(await screen.findByRole('button', { name: /^Forget “/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Forget it' }));
    await waitFor(() => expect(fns.forgetMemory).toHaveBeenCalledWith('m1'));
    expect(await screen.findByText(/It is no longer recalled\./)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(fns.restoreMemory).toHaveBeenCalledWith('m1'));
    expect(await screen.findByText(/is recalled again/)).toBeTruthy();
  });

  it('lists what was forgotten, and a harness without restore says so in words', async () => {
    const fns = api({
      listMemories: vi
        .fn()
        .mockResolvedValue([
          row({ id: 'm1', content: 'Old fact.', status: 'forgotten', updated_at: now - HOUR }),
        ]),
      restoreMemory: vi.fn().mockRejectedValue(new Error('memory/restore: 405 Method Not Allowed')),
    });
    await mount('/harness/memory?view=forgotten');
    expect(await screen.findByText('forgotten 1h ago')).toBeTruthy();
    expect(fns.listMemories).toHaveBeenCalledWith(expect.objectContaining({ status: 'forgotten' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore “Old fact.”' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/cannot restore/);
  });
});

describe('as of a turn', () => {
  it('asks for a conversation before a turn, and sends the conversation', async () => {
    const fns = api();
    await mount('/harness/memory?view=asof&turn=4');
    // A turn alone is every conversation's fourth turn: nothing is asked yet.
    expect(await screen.findByText(/Pick a conversation and one of its turns/)).toBeTruthy();
    expect(fns.memoriesAsOf).not.toHaveBeenCalled();
    cleanup();

    await mount('/harness/memory?view=asof&thread=thread-a&turn=4');
    await waitFor(() =>
      expect(fns.memoriesAsOf).toHaveBeenCalledWith(
        4,
        expect.objectContaining({ threadId: 'thread-a' }),
      ),
    );
  });

  it('follows a row link into As of without losing the conversation', async () => {
    api({
      listMemories: vi.fn().mockResolvedValue([row({ id: 'm1', content: 'Ship on Fridays.' })]),
    });
    await mount();
    fireEvent.click(await screen.findByRole('link', { name: 'turn 4' }));
    await waitFor(() => {
      const where = screen.getByTestId('where').textContent ?? '';
      expect(where).toContain('view=asof');
      expect(where).toContain('thread=thread-a');
      expect(where).toContain('turn=4');
    });
  });
});

describe('adding', () => {
  it('hides the view inputs while the form is open, so two forms are never stacked', async () => {
    api();
    await mount('/harness/memory?view=search');
    expect(await screen.findByLabelText('What would it recall?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Add memory' }));
    expect(screen.queryByLabelText('What would it recall?')).toBeNull();
    expect(document.activeElement?.id).toBe('memory-content');
  });
});

describe('the composition the second critique asked for', () => {
  it('cuts a long title from the middle, so two that share an opening still differ', async () => {
    api({
      listMemories: vi.fn().mockResolvedValue([row({ id: 'm1', content: 'A fact.' })]),
    });
    const { MemorySection } = await import('../src/components/harness/memory');
    const { PanelModeProvider } = await import('../src/components/inspector/primitives');
    const { ShellProvider } = await import('../src/shell-context');
    const title = 'Create notes/todo.md with three short tasks for today';
    const shell = {
      threads: [{ id: 'thread-a', title, manifest: 'cowork', updatedAt: now }],
      manifest: 'cowork',
      manifestOptions: ['cowork'],
    } as unknown as ShellValue;
    render(
      <MemoryRouter initialEntries={['/harness/memory']}>
        <ShellProvider value={shell}>
          <PanelModeProvider>
            <MemorySection enabled open onToggle={() => {}} />
          </PanelModeProvider>
        </ShellProvider>
      </MemoryRouter>,
    );
    const link = await screen.findByRole('link', { name: `Conversation “${title}”` });
    expect(link.textContent).toBe('“Create notes/to… tasks for today”');
    expect(link.textContent?.length).toBeLessThanOrEqual(34);
    expect(link.getAttribute('title')).toBe(title);
  });

  it('does not repeat the conversation and turn As of is already about', async () => {
    api({
      memoriesAsOf: vi.fn().mockResolvedValue([row({ id: 'm1', content: 'Ship on Fridays.' })]),
    });
    await mount('/harness/memory?view=asof&thread=thread-a&turn=4');
    const item = (await screen.findByText('Ship on Fridays.')).closest('li') as HTMLElement;
    expect(within(item).queryByRole('link')).toBeNull();
    expect(within(item).getByText('written 2h ago')).toBeTruthy();
    // The header counts; the conversation is named once, in its field.
    expect(screen.getByText('1 memory at turn 4')).toBeTruthy();
  });

  it('keeps the As-of help on its own line, out of the row the filter sits in', async () => {
    api();
    await mount('/harness/memory?view=asof');
    const help = await screen.findByText(/What the conversation had stored by that turn/);
    const agent = screen.getByLabelText('Agent');
    // The row the filter wraps in no longer holds the help, which used to take the
    // leftover space in it and put Agent beside a paragraph.
    const row = agent.closest('.flex-wrap') as HTMLElement;
    expect(row.contains(help)).toBe(false);
  });

  it('says an older harness keeps no forgotten list, without an error or a retry', async () => {
    api({
      listMemories: vi
        .fn()
        .mockRejectedValue(new Error('memory: 404 this harness does not list forgotten memories')),
    });
    await mount('/harness/memory?view=forgotten');
    expect(await screen.findByText(/older than this page: it keeps no list/)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button', { name: /try again/i })).toBeNull();
  });

  it('says when a harness does not report where search hits came from', async () => {
    const bare: MemoryHit = { id: 'h1', content: 'Ship on Fridays.', kind: 'task', score: 0.1 };
    api({ searchMemories: vi.fn().mockResolvedValue([bare]) });
    await mount('/harness/memory?view=search&q=ship');
    expect(await screen.findByText(/does not say where a search hit came from/)).toBeTruthy();
  });

  it('keeps an armed Forget able to narrow: shrink-0 is on the resting button only', async () => {
    api({
      listMemories: vi.fn().mockResolvedValue([row({ id: 'm1', content: 'Ship on Fridays.' })]),
    });
    await mount();
    const resting = await screen.findByRole('button', { name: /^Forget “/ });
    expect(resting.className).toContain('shrink-0');
    fireEvent.click(resting);
    const armed = screen.getByRole('group', { name: 'Forget it' });
    expect(armed.className).not.toContain('shrink-0');
    expect((armed.closest('li') as HTMLElement).className).toContain('flex-wrap');
  });

  it('confirms an added memory, names the agent, and marks the row', async () => {
    const fns = api({
      addMemory: vi.fn().mockResolvedValue({ id: 'm9', status: 'active' }),
      listMemories: vi
        .fn()
        .mockResolvedValue([row({ id: 'm9', content: 'Staging is :8081.', thread_id: '' })]),
    });
    await mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Add memory' }));
    expect(screen.getByText(/It starts as the agent Chat is using/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('What to remember'), {
      target: { value: 'Staging is :8081.' },
    });
    fireEvent.click(screen.getByRole('button', { name: /remember it/i }));
    await waitFor(() => expect(fns.addMemory).toHaveBeenCalled());
    const notice = await screen.findByText(/It can be recalled from that agent's next run/);
    expect(notice.textContent).toMatch(/Stored for cowork: “Staging is :8081\.”/);
    const item = (await screen.findAllByText('Staging is :8081.'))
      .map((n) => n.closest('li'))
      .find(Boolean) as HTMLElement;
    expect(item.className).toContain('bg-muted');
  });

  it('keeps Undo through a change of view', async () => {
    api({
      listMemories: vi.fn().mockResolvedValue([row({ id: 'm1', content: 'Ship on Fridays.' })]),
    });
    await mount();
    fireEvent.click(await screen.findByRole('button', { name: /^Forget “/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Forget it' }));
    await screen.findByText(/It is no longer recalled\./);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  });
});
