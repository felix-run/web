// @vitest-environment happy-dom
import { WorkspaceChangedError } from '@felix/client';
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidePane } from '../src/components/pane/side-pane';
import { WorkspaceSection } from '../src/components/workspace/workspace-section';
import { openInPane, paneState, resetPanes } from '../src/lib/side-pane';
import { ShellProvider, type ShellValue } from '../src/shell-context';

/**
 * The thread's workspace on the harness, in the sidebar and the side pane.
 *
 * An agent whose file tools are the harness's never reads the browser's
 * workspace, so an edit saved there reached it as a note about a file it then
 * could not find (seen live on :8080). These pin the other half: the sidebar
 * lists the harness workspace for such an agent and only for one, a file opens
 * from there, and a save goes back there — conditional on the hash it was read
 * at, telling the agent in the same request, and stopping on the same choice an
 * agent's write under an edit always stops on when the file has moved.
 */

const harness = vi.hoisted(() => ({
  files: {} as Record<string, { text: string; sha: string }>,
  tree: vi.fn(),
  read: vi.fn(),
  write: vi.fn(),
  del: vi.fn(),
  rename: vi.fn(),
  localDelete: vi.fn(async (_p: string) => {}),
  localRename: vi.fn(async (_a: string, _b: string) => {}),
}));

vi.mock('../src/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/api')>()),
  workspaceTree: harness.tree,
  workspaceRead: harness.read,
  workspaceWrite: harness.write,
  workspaceDelete: harness.del,
  workspaceRename: harness.rename,
}));

vi.mock('../src/lib/cowork', () => ({
  getMountLabel: () => null,
  hasMount: () => false,
  mountTree: async () => [],
  vfs: { tree: () => [], read: () => '', write: () => {} },
  readWorkspaceBytes: async (p: string) =>
    p === 'local.md' ? new TextEncoder().encode('# Local\n') : null,
  readWorkspaceFile: async () => null,
  writeWorkspaceFile: async () => {},
  deleteWorkspaceFile: harness.localDelete,
  renameWorkspaceFile: harness.localRename,
  executeClientTool: async () => ({ ok: true }),
  restoreMount: async () => ({ status: 'none' }),
  reconnectMount: async () => null,
  pickDirectory: async () => 'x',
  clearMount: () => {},
  supportsDirectoryPicker: () => false,
  collectTouchedPaths: () => [],
}));

const T = 'hw';
const SHA1 = '1'.repeat(64);
const SHA2 = '2'.repeat(64);

function shell(over: Partial<ShellValue> = {}): ShellValue {
  return {
    turns: [],
    threadId: T,
    streaming: false,
    threads: [],
    manifest: 'contributor',
    manifestEntries: [{ id: 'contributor', workspace: { tools: 'server', scope: 'thread' } }],
    openInPane: (item: Parameters<NonNullable<ShellValue['openInPane']>>[0]) => openInPane(T, item),
    tellAgentEdited: vi.fn(async () => 'queued' as const),
    ...over,
  } as unknown as ShellValue;
}

function mount(value: ShellValue = shell()) {
  return render(
    <TooltipProvider>
      <ShellProvider value={value}>
        <WorkspaceSection />
        <SidePane threadId={T} changedPaths={new Set()} runPaths={new Set()} streaming={false} />
      </ShellProvider>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  resetPanes();
  harness.files = { 'src/app.py': { text: 'x = 1\n', sha: SHA1 } };
  harness.tree.mockImplementation(async () => ({
    rootKind: 'scoped',
    scope: 'thread',
    manifest: 'contributor',
    entries: [
      { path: 'src', type: 'dir' },
      { path: 'src/app.py', type: 'file', bytes: 6 },
    ],
    truncated: false,
  }));
  harness.read.mockImplementation(async ({ path }: { path: string }) => {
    const f = harness.files[path];
    if (!f) throw Object.assign(new Error('nf'), { code: 'not_found' });
    return { path, bytes: new TextEncoder().encode(f.text), sha256: f.sha };
  });
  harness.write.mockImplementation(async ({ path, content }: { path: string; content: string }) => {
    harness.files[path] = { text: content, sha: SHA2 };
    return { status: 'queued', bytes: content.length, sha256: SHA2, eventId: null };
  });
});
afterEach(() => {
  cleanup();
  harness.tree.mockReset();
  harness.read.mockReset();
  harness.write.mockReset();
  harness.del.mockReset();
  harness.rename.mockReset();
  harness.localDelete.mockClear();
  harness.localRename.mockClear();
});

async function editHarnessFile(user: ReturnType<typeof userEvent.setup>, text: string) {
  act(() => openInPane(T, { kind: 'file', path: 'src/app.py', source: 'harness' }));
  await user.click(await screen.findByRole('button', { name: 'Edit' }));
  fireEvent.change(await screen.findByRole('textbox', { name: 'src/app.py source' }), {
    target: { value: text },
  });
}

describe('the sidebar', () => {
  it('lists the harness workspace for an agent whose tools work there, and opens from it', async () => {
    const user = userEvent.setup();
    mount();
    expect(await screen.findByRole('button', { name: /On the harness/ })).toBeTruthy();
    expect(harness.tree).toHaveBeenCalledWith({ threadId: T, manifest: 'contributor' });
    await user.click(screen.getByRole('button', { name: 'src' }));
    await user.click(await screen.findByText('app.py'));
    await waitFor(() => expect(paneState(T).active).toBe('harness:src/app.py'));
  });

  it('draws nothing for an agent that works in the browser', async () => {
    mount(
      shell({
        manifest: 'cowork',
        manifestEntries: [{ id: 'cowork', workspace: { tools: 'client', scope: 'thread' } }],
      }),
    );
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByRole('button', { name: /On the harness/ })).toBeNull();
    expect(harness.tree).not.toHaveBeenCalled();
  });
});

describe('a harness file in the pane', () => {
  it('saves back to the harness at the hash it was read, and lets the harness tell the agent', async () => {
    const value = shell();
    const user = userEvent.setup();
    mount(value);
    await editHarnessFile(user, 'x = 2\n');
    expect(document.querySelector('[data-slot="side-pane"]')?.textContent).toContain(
      'On the harness',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(harness.write).toHaveBeenCalledWith({
        threadId: T,
        path: 'src/app.py',
        content: 'x = 2\n',
        expectedSha256: SHA1,
        manifest: 'contributor',
      }),
    );
    expect(
      await screen.findByText('Saved. The agent reads this before its next step.'),
    ).toBeTruthy();
    // One request did both: the browser path's separate notice is not sent too.
    expect(value.tellAgentEdited).not.toHaveBeenCalled();
  });

  it('shows the note in the transcript when the harness recorded it on an idle thread', async () => {
    harness.write.mockImplementationOnce(async () => ({
      status: 'recorded',
      bytes: 6,
      sha256: SHA2,
      eventId: 'e7',
    }));
    const showRecordedNote = vi.fn();
    const user = userEvent.setup();
    mount(shell({ showRecordedNote }));
    await editHarnessFile(user, 'x = 4\n');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(
      await screen.findByText('Saved. The agent was told, and reads it on its next turn.'),
    ).toBeTruthy();
    expect(showRecordedNote).toHaveBeenCalledOnce();
  });

  it('stops on the choice when the file moved on the harness, then saves at its new hash', async () => {
    harness.write.mockImplementationOnce(async () => {
      harness.files['src/app.py'] = { text: 'x = 1\nagent = True\n', sha: SHA2 };
      throw new WorkspaceChangedError(SHA2, 19);
    });
    const user = userEvent.setup();
    mount();
    await editHarnessFile(user, 'x = 3\n');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The agent changed this file');
    expect(await screen.findByText(/changed on the harness since you opened it/)).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'Keep my edits' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(harness.write).toHaveBeenCalledTimes(2));
    expect(harness.write.mock.calls[1]?.[0]).toMatchObject({
      content: 'x = 3\n',
      expectedSha256: SHA2,
    });
  });
});

describe('renaming and deleting', () => {
  async function chooseFrom(user: ReturnType<typeof userEvent.setup>, item: RegExp) {
    await user.click(await screen.findByRole('button', { name: 'More file actions' }));
    await user.click(await screen.findByRole('menuitem', { name: item }));
  }

  it('deletes a harness file at the hash it was read, closes its tab, and says the agent was told', async () => {
    harness.del.mockResolvedValueOnce({ status: 'queued', eventId: null });
    const user = userEvent.setup();
    mount();
    act(() => openInPane(T, { kind: 'file', path: 'src/app.py', source: 'harness' }));
    await screen.findByText(/2 lines|1 line/);
    await chooseFrom(user, /Delete/);
    const ask = await screen.findByRole('alertdialog', { name: 'Delete the file' });
    expect(ask.textContent).toContain('on the harness');
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() =>
      expect(harness.del).toHaveBeenCalledWith({
        threadId: T,
        path: 'src/app.py',
        expectedSha256: SHA1,
        manifest: 'contributor',
      }),
    );
    await waitFor(() => expect(paneState(T).items).toHaveLength(0));
  });

  it('renames a harness file and opens it under its new path', async () => {
    harness.rename.mockResolvedValueOnce({
      status: 'recorded',
      toPath: 'src/main.py',
      sha256: SHA1,
      eventId: 'e2',
    });
    const user = userEvent.setup();
    mount();
    act(() => openInPane(T, { kind: 'file', path: 'src/app.py', source: 'harness' }));
    await screen.findByText(/2 lines|1 line/);
    await chooseFrom(user, /Rename/);
    const field = await screen.findByRole('textbox', { name: /New path/ });
    await user.clear(field);
    await user.type(field, 'src/main.py{Enter}');
    await waitFor(() =>
      expect(harness.rename).toHaveBeenCalledWith(
        expect.objectContaining({
          path: 'src/app.py',
          toPath: 'src/main.py',
          expectedSha256: SHA1,
        }),
      ),
    );
    await waitFor(() => expect(paneState(T).active).toBe('harness:src/main.py'));
    expect(paneState(T).items.map((i) => i.key)).toEqual(['harness:src/main.py']);
  });

  it('says a taken name is taken, and leaves the file where it was', async () => {
    harness.localRename.mockRejectedValueOnce(
      Object.assign(new Error('target exists: b.md'), { name: 'TargetExistsError' }),
    );
    const value = shell();
    const user = userEvent.setup();
    mount(value);
    act(() => openInPane(T, { kind: 'file', path: 'local.md' }));
    await screen.findByText(/1 line/);
    await chooseFrom(user, /Rename/);
    const field = await screen.findByRole('textbox', { name: /New path/ });
    await user.clear(field);
    await user.type(field, 'b.md{Enter}');
    expect(await screen.findByText('A file is already at b.md. Choose another path.')).toBeTruthy();
    expect(paneState(T).active).toBe('file:local.md');
    expect(value.tellAgentEdited).not.toHaveBeenCalled();
  });

  it('deletes a browser file in its own store, then tells the agent', async () => {
    const value = shell();
    const user = userEvent.setup();
    mount(value);
    act(() => openInPane(T, { kind: 'file', path: 'local.md' }));
    await screen.findByText(/1 line/);
    await chooseFrom(user, /Delete/);
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(harness.localDelete).toHaveBeenCalledWith('local.md'));
    await waitFor(() =>
      expect(value.tellAgentEdited).toHaveBeenCalledWith({ path: 'local.md', op: 'delete' }),
    );
    expect(harness.del).not.toHaveBeenCalled();
  });

  it('holds both while the file has an unsaved edit', async () => {
    const user = userEvent.setup();
    mount();
    await editHarnessFile(user, 'x = 9\n');
    await user.click(screen.getByRole('button', { name: 'More file actions' }));
    expect(
      (await screen.findByRole('menuitem', { name: /Delete/ })).getAttribute('data-disabled'),
    ).not.toBeNull();
    expect(screen.getByText('Save or revert your edits first.')).toBeTruthy();
  });
});
