/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Greeting } from '../src/components/chat/greeting';
import { itemMessage } from '../src/components/chat/start-from-item';
import { resetMountState } from '../src/lib/mount-state';
import { ShellProvider, type ShellValue } from '../src/shell-context';

/**
 * The empty thread: a welcome headline, the agent's starter cards, and a one-line
 * readout of what the first message will be sent to.
 *
 * The readout is pinned because it is the part a redesign drops first, and
 * "harness unreachable" is the one fact here that changes what to do next. Each
 * card shows the prompt it sends, and the click sends exactly that.
 */

const fs = vi.hoisted(() => ({ label: null as string | null, picker: false }));
vi.mock('../src/lib/cowork', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/cowork')>()),
  getMountLabel: () => fs.label,
  supportsDirectoryPicker: () => fs.picker,
  pickDirectory: async () => {
    fs.label = 'notes';
    return 'notes';
  },
  restoreMount: async () => ({ status: 'none' }),
}));

const github = vi.hoisted(() => ({ session: null as { login: string } | null }));
vi.mock('../src/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/lib/auth')>()),
  getSession: () => github.session,
  subscribeCredentials: () => () => {},
}));

const repos = vi.hoisted(() => ({
  listMyRepos: vi.fn(async () => ({
    repositories: [{ full_name: 'acme/widgets', private: false, archived: false, can_write: true }],
    truncated: false,
    install_url: null,
  })),
  openThreadRepo: vi.fn(async (_thread: string, full: string) => ({
    state: 'cloning',
    repo: full,
    branch: null,
  })),
  getThreadRepo: vi.fn(),
  listRepoItems: vi.fn(async () => ({
    repository: 'acme/widgets',
    items: [
      {
        number: 12,
        kind: 'issue',
        title: 'Crash on empty input',
        state: 'open',
        html_url: 'https://github.com/acme/widgets/issues/12',
        author: 'octo',
        updated_at: '2026-10-27T00:00:00Z',
      },
    ],
    truncated: false,
  })),
  getRepoItem: vi.fn(async () => ({
    number: 12,
    kind: 'issue',
    title: 'Crash on empty input',
    state: 'open',
    html_url: 'https://github.com/acme/widgets/issues/12',
    author: 'octo',
    updated_at: '2026-10-27T00:00:00Z',
    body: 'Steps:\n1. submit nothing',
    body_truncated: false,
  })),
}));
vi.mock('../src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api')>()),
  ...repos,
}));

afterEach(() => {
  cleanup();
  fs.label = null;
  fs.picker = false;
  github.session = null;
  resetMountState();
  vi.clearAllMocks();
});

function mount(over: Partial<ShellValue> = {}, manifest = 'cowork', blocked = false) {
  const shell = {
    threadId: 'a1b2c3',
    harnessReachable: true,
    streaming: false,
    send: vi.fn(),
    manifestEntries: [],
    ...over,
  } as ShellValue;
  render(
    <ShellProvider value={shell}>
      <Greeting manifest={manifest} blocked={blocked} />
    </ShellProvider>,
  );
  return shell;
}

describe('the readout of where files are', () => {
  const agent = (tools: string) =>
    ({
      manifestEntries: [{ id: 'cowork', workspace: { tools, scope: 'thread' } }],
    }) as unknown as Partial<ShellValue>;

  it('names no folder for an agent with no file tools', () => {
    mount(agent('none'));
    expect(screen.queryByText('Folder')).toBeNull();
    expect(screen.queryByText('none mounted')).toBeNull();
  });

  it('says the files are on the harness for an agent whose tools are there', () => {
    mount(agent('server'));
    expect(screen.queryByText('Folder')).toBeNull();
    expect(screen.getByText('on the harness')).toBeTruthy();
  });

  it('names the folder for an agent that works in the browser', () => {
    mount(agent('both'));
    expect(screen.getByText('none mounted')).toBeTruthy();
  });
});

describe('the empty thread', () => {
  it('welcomes, and still reads out what the first message will be sent to', () => {
    mount();
    expect(screen.getByRole('heading', { name: 'What do you want to work on?' })).toBeTruthy();
    // Named in the welcome sentence and again in the readout.
    expect(screen.getAllByText('cowork')).toHaveLength(2);
    expect(screen.getByText('a1b2c3')).toBeTruthy();
    expect(screen.getByText('none mounted')).toBeTruthy();
    expect(screen.getByText('reachable')).toBeTruthy();
  });

  /**
   * A thread with a call waiting on you is not asking what to work on. The
   * headline and starters step aside; the readout, which is facts, stays.
   */
  it('steps aside while the thread is waiting on you, keeping the readout', () => {
    mount({}, 'cowork', true);
    expect(screen.queryByRole('heading', { name: 'What do you want to work on?' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^List the workspace/ })).toBeNull();
    expect(screen.getByRole('region', { name: 'Empty thread' })).toBeTruthy();
    expect(screen.getByText('reachable')).toBeTruthy();
  });

  it('cuts a long thread id from the middle, whole to a screen reader', () => {
    const id = '4f6c1e2a-0b7d-4c55-9a51-2f0e8d6b1a90';
    mount({ threadId: id });
    // The tail survives: it is what tells one thread from another.
    expect(screen.getByText('4f6c1e…d6b1a90')).toBeTruthy();
    expect(screen.getByText(id).className).toContain('sr-only');
  });

  it("offers the agent's starter prompts and sends the full prompt on click", () => {
    const shell = mount();
    const button = screen.getByRole('button', { name: /^List the workspace/ });
    fireEvent.click(button);
    expect(shell.send).toHaveBeenCalledWith(
      'List the top-level files and folders in the workspace.',
    );
  });

  it('falls back to a general set for an agent with none of its own', () => {
    mount({}, 'router');
    expect(screen.getByRole('button', { name: /^What can you do?/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^List the workspace/ })).toBeNull();
  });

  it("prefers the manifest's own starters over the built-in table", () => {
    const shell = mount({
      manifestEntries: [
        { id: 'cowork', starters: [{ title: 'Tidy notes', prompt: 'Tidy the notes folder.' }] },
      ],
    });
    expect(screen.queryByRole('button', { name: /^List the workspace/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /^Tidy notes/ }));
    expect(shell.send).toHaveBeenCalledWith('Tidy the notes folder.');
  });

  it('gives a manifest that declares no starters the general pair, not the name table', () => {
    mount({ manifestEntries: [{ id: 'cowork', starters: [] }] });
    expect(screen.getByRole('button', { name: /^What can you do?/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^List the workspace/ })).toBeNull();
  });

  // A folder is mounted here since 2026-10-16: a browser-tools agent's greeting is about its
  // folder, and without one the client's own copy stands in (the case below).
  it("uses the manifest's own headline and subtitle", () => {
    fs.label = 'notes';
    mount({
      manifestEntries: [
        {
          id: 'cowork',
          greeting: { headline: 'What should we do in this folder?', subtitle: 'Reads freely.' },
        },
      ],
    });
    expect(screen.getByRole('heading', { name: 'What should we do in this folder?' })).toBeTruthy();
    expect(screen.getByText('Reads freely.')).toBeTruthy();
    expect(screen.queryByText(/You're chatting with/)).toBeNull();
  });

  /**
   * "What should we do in this folder?" over a readout saying "none mounted" contradicted
   * itself. The manifest has no second greeting, so with no folder the client's headline and a
   * sentence saying where the tools work stand in; the starters stay.
   */
  it('does not ask about a folder when none is mounted, and keeps the starters', () => {
    mount({
      manifestEntries: [
        {
          id: 'cowork',
          greeting: { headline: 'What should we do in this folder?', subtitle: 'Reads freely.' },
          workspace: { tools: 'client', scope: 'thread' },
        },
      ] as unknown as ShellValue['manifestEntries'],
    });
    expect(screen.queryByRole('heading', { name: /this folder/ })).toBeNull();
    expect(screen.getByRole('heading', { name: 'What do you want to work on?' })).toBeTruthy();
    expect(screen.queryByText('Reads freely.')).toBeNull();
    expect(screen.getByText(/No folder is mounted/)).toBeTruthy();
    expect(screen.getByText('none mounted')).toBeTruthy();
    expect(screen.getByRole('button', { name: /^List the workspace/ })).toBeTruthy();
  });

  it("keeps the manifest's greeting for an agent whose files are on the harness", () => {
    mount({
      manifestEntries: [
        {
          id: 'cowork',
          greeting: { headline: 'Ready when you are' },
          workspace: { tools: 'server', scope: 'thread' },
        },
      ] as unknown as ShellValue['manifestEntries'],
    });
    expect(screen.getByRole('heading', { name: 'Ready when you are' })).toBeTruthy();
  });

  it('keeps the sentence naming the agent when the manifest sets only a headline', () => {
    fs.label = 'notes';
    mount({ manifestEntries: [{ id: 'cowork', greeting: { headline: 'Hello' } }] });
    expect(screen.getByRole('heading', { name: 'Hello' })).toBeTruthy();
    expect(screen.getByText(/You're chatting with/)).toBeTruthy();
  });

  it('disables the starters while a run is streaming', () => {
    mount({ streaming: true });
    for (const b of screen.getAllByRole('button'))
      expect((b as HTMLButtonElement).disabled).toBe(true);
  });

  it('says a send will fail while the harness is unreachable', () => {
    mount({ harnessReachable: false });
    expect(screen.getByText(/unreachable/).className).toMatch(/text-state-failed/);
  });
});

/**
 * Where the thread runs is chosen in the readout, before the first message — the one
 * moment that choice is cheap. The readout goes with the greeting at the first send.
 */
describe('choosing where the thread runs', () => {
  const agent = (tools: string) =>
    ({
      manifestEntries: [{ id: 'cowork', workspace: { tools, scope: 'thread' } }],
    }) as unknown as Partial<ShellValue>;

  it('mounts a folder from the readout where the browser can', async () => {
    fs.picker = true;
    mount(agent('client'));
    fireEvent.click(screen.getByRole('button', { name: 'Mount a folder' }));
    await waitFor(() => expect(screen.getByText('notes')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Mount a folder' })).toBeNull();
  });

  it('offers no mount, and does not promise one, where the browser cannot', () => {
    mount(agent('client'));
    expect(screen.queryByRole('button', { name: 'Mount a folder' })).toBeNull();
  });

  it('has no Repository line without a GitHub sign-in, and asks nothing', () => {
    mount(agent('server'));
    expect(screen.queryByText('Repository')).toBeNull();
    expect(repos.listMyRepos).not.toHaveBeenCalled();
  });

  it('opens a repository for this thread before its first message', async () => {
    github.session = { login: 'octo' };
    mount(agent('server'));
    expect(screen.getByText('Repository')).toBeTruthy();
    // Nothing is asked of the harness on load: the thread has no message yet.
    expect(repos.getThreadRepo).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Open a repository' }));
    fireEvent.click(await screen.findByRole('button', { name: /acme\/widgets/ }));
    await waitFor(() =>
      expect(repos.openThreadRepo).toHaveBeenCalledWith('a1b2c3', 'acme/widgets'),
    );
    expect(await screen.findByText(/cloning/)).toBeTruthy();
  });

  it('has no Repository line for an agent whose tools work only in the browser', () => {
    github.session = { login: 'octo' };
    mount(agent('client'));
    expect(screen.queryByText('Repository')).toBeNull();
  });
});

/**
 * "Start from an issue or PR": one of the open repository's items, put in the composer for
 * the operator to add to. Its description is whoever opened the issue, so unlike a starter
 * it is never sent on a click.
 */
describe('starting from an issue or pull request', () => {
  const server = {
    manifestEntries: [{ id: 'cowork', workspace: { tools: 'server', scope: 'thread' } }],
  } as unknown as Partial<ShellValue>;

  it('is offered only once a repository is open, and fills the composer without sending', async () => {
    github.session = { login: 'octo' };
    const draftMessage = vi.fn();
    const shell = mount({ ...server, draftMessage });
    expect(screen.queryByRole('button', { name: /Start from an issue or PR/ })).toBeNull();

    fireEvent.click(await screen.findByRole('button', { name: 'Open a repository' }));
    fireEvent.click(await screen.findByRole('button', { name: /acme\/widgets/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Start from an issue or PR/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Crash on empty input/ }));

    await waitFor(() => expect(draftMessage).toHaveBeenCalledOnce());
    expect(repos.getRepoItem).toHaveBeenCalledWith('acme/widgets', 12);
    expect(draftMessage.mock.calls[0]?.[0]).toBe(
      'Issue acme/widgets#12: Crash on empty input\nhttps://github.com/acme/widgets/issues/12\n\nSteps:\n1. submit nothing\n\n',
    );
    expect(shell.send).not.toHaveBeenCalled();
  });
});

describe('itemMessage', () => {
  const base = {
    number: 3,
    kind: 'pull' as const,
    title: 'Add dark mode',
    state: 'open',
    html_url: 'https://github.com/acme/widgets/pull/3',
    author: 'octo',
    updated_at: '',
    body: '',
    body_truncated: false,
  };

  it('names the item and links it, and adds no instruction of its own', () => {
    expect(itemMessage('acme/widgets', base)).toBe(
      'Pull request acme/widgets#3: Add dark mode\nhttps://github.com/acme/widgets/pull/3\n\n',
    );
  });

  it('says when the harness cut the description', () => {
    expect(itemMessage('acme/widgets', { ...base, body: 'long…', body_truncated: true })).toContain(
      '(The description was cut at 20,000 characters.)',
    );
  });
});
