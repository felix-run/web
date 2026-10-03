// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSection } from '../src/components/workspace/workspace-section';
import { languageFor, PREVIEW_LIMIT, previewOf } from '../src/lib/file-preview';
import { ShellProvider, type ShellValue } from '../src/shell-context';

/**
 * A workspace file opens in a read-only drawer.
 *
 * The tree said what exists and what this thread changed; the drawer says what
 * is in it. It reads through the same `readWorkspaceFile` the approval diff
 * uses, so the store is a double here and what is pinned is which file is read,
 * what each of its four states says, and that a folder still folds.
 */

const files = vi.hoisted(() => ({
  tree: ['d notes', 'f notes/plan.md', 'f data.bin'] as string[],
  body: {} as Record<string, string>,
  read: vi.fn(async (_p: string) => null as string | null),
}));

vi.mock('../src/lib/cowork', () => ({
  getMountLabel: () => null,
  hasMount: () => false,
  mountTree: async () => [],
  vfs: { tree: () => files.tree },
  readWorkspaceFile: files.read,
  restoreMount: async () => ({ status: 'none' }),
  reconnectMount: async () => null,
  pickDirectory: async () => 'x',
  clearMount: () => {},
  supportsDirectoryPicker: () => false,
  collectTouchedPaths: () => [],
}));

function mount() {
  const value = { turns: [], threadId: 'now', streaming: false } as unknown as ShellValue;
  return render(
    <TooltipProvider>
      <ShellProvider value={value}>
        <WorkspaceSection />
      </ShellProvider>
    </TooltipProvider>,
  );
}

beforeEach(() => {
  files.body = {
    'notes/plan.md': '# Plan\n\nShip the preview.\n',
    'data.bin': 'PK\u0003\u0004\u0000\u0000binary',
  };
  files.read.mockImplementation(async (p: string) => files.body[p] ?? null);
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  files.read.mockReset();
});

describe('the file preview', () => {
  it('opens a file from the tree, read from the workspace store', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'notes' }));
    await user.click(await screen.findByText('plan.md'));
    const dialog = await screen.findByRole('dialog');
    expect(files.read).toHaveBeenCalledWith('notes/plan.md');
    expect(dialog.textContent).toContain('notes/plan.md');
    await waitFor(() => expect(dialog.textContent).toContain('Ship the preview.'));
    expect(dialog.textContent).toContain('3 lines');
    expect(dialog.textContent).toContain('Read-only');
  });

  it('says a binary file is binary rather than drawing it', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByText('data.bin'));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.textContent).toContain('Binary file'));
    expect(dialog.textContent).not.toContain('PK');
  });

  it('says a file that has gone is gone', async () => {
    delete files.body['notes/plan.md'];
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'notes' }));
    await user.click(await screen.findByText('plan.md'));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.textContent).toContain('no longer in the workspace'));
  });

  it('folds a folder by its name, and opens nothing for it', async () => {
    const user = userEvent.setup();
    mount();
    const folder = await screen.findByRole('button', { name: 'notes' });
    await user.click(folder);
    expect(await screen.findByText('plan.md')).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(files.read).not.toHaveBeenCalled();
  });
});

describe('previewOf', () => {
  it('counts lines, without a phantom one for the final newline', () => {
    expect(previewOf('a\nb\n')).toEqual({
      kind: 'text',
      text: 'a\nb\n',
      lines: 2,
      truncated: false,
    });
    expect(previewOf('')).toMatchObject({ lines: 0 });
  });

  it('keeps the head of a large file, cut at a line', () => {
    const line = `${'x'.repeat(99)}\n`;
    const p = previewOf(line.repeat(PREVIEW_LIMIT / 100 + 50));
    expect(p.kind === 'text' && p.truncated).toBe(true);
    expect(p.kind === 'text' && p.text.length).toBeLessThanOrEqual(PREVIEW_LIMIT);
    expect(p.kind === 'text' && p.text.endsWith('\n')).toBe(true);
  });
});

describe('languageFor', () => {
  it('highlights what it knows and leaves the rest plain', () => {
    expect(languageFor('src/app.tsx')).toBe('tsx');
    expect(languageFor('deploy/Dockerfile')).toBe('docker');
    expect(languageFor('notes.txt')).toBeNull();
    expect(languageFor('.env')).toBeNull();
  });
});
