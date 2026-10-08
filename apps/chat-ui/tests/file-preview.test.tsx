// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WorkspaceSection } from '../src/components/workspace/workspace-section';
import {
  isMarkdown,
  languageFor,
  PREVIEW_LIMIT,
  previewOf,
  previewOfBytes,
  sniffMedia,
} from '../src/lib/file-preview';
import { ShellProvider, type ShellValue } from '../src/shell-context';

/**
 * A workspace file opens in a read-only drawer.
 *
 * The tree said what exists and what this thread changed; the drawer says what
 * is in it. It reads the file's bytes from the same store, with the same
 * precedence, as the approval diff, so the store is a double here and what is
 * pinned is which file is read, what each of its states says, that media is
 * drawn as itself (and its object URL let go), and that a folder still folds.
 */

const files = vi.hoisted(() => ({
  tree: ['d notes', 'f notes/plan.md', 'f data.bin', 'f pic.png', 'f logo.svg'] as string[],
  body: {} as Record<string, string | Uint8Array>,
  read: vi.fn(async (_p: string) => null as Uint8Array | null),
}));

vi.mock('../src/lib/cowork', () => ({
  getMountLabel: () => null,
  hasMount: () => false,
  mountTree: async () => [],
  vfs: { tree: () => files.tree },
  readWorkspaceBytes: files.read,
  restoreMount: async () => ({ status: 'none' }),
  reconnectMount: async () => null,
  pickDirectory: async () => 'x',
  clearMount: () => {},
  supportsDirectoryPicker: () => false,
  collectTouchedPaths: () => [],
}));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

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
    'pic.png': PNG,
    'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>\n',
  };
  files.read.mockImplementation(async (p: string) => {
    const body = files.body[p];
    if (body === undefined) return null;
    return typeof body === 'string' ? new TextEncoder().encode(body) : body;
  });
  localStorage.clear();
  // Files starts folded; these are about what opens from the tree.
  localStorage.setItem('felix.sidebar.filesOpen', '1');
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

  it('renders markdown, with its source a toggle away', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'notes' }));
    await user.click(await screen.findByText('plan.md'));
    const dialog = await screen.findByRole('dialog');
    const heading = await waitFor(() => {
      const h = dialog.querySelector('h1');
      if (!h) throw new Error('not rendered yet');
      return h;
    });
    expect(heading.textContent).toBe('Plan');
    expect(screen.getByRole('button', { name: 'rendered' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'source' }));
    await waitFor(() => expect(dialog.textContent).toContain('# Plan'));
    expect(dialog.querySelector('h1')).toBeNull();
  });

  it('draws an image as itself, and lets its object URL go on close', async () => {
    const created: string[] = [];
    const revoked: string[] = [];
    const urls = URL as unknown as {
      createObjectURL: (b: Blob) => string;
      revokeObjectURL: (u: string) => void;
    };
    const original = { create: urls.createObjectURL, revoke: urls.revokeObjectURL };
    urls.createObjectURL = (b: Blob) => {
      const u = `blob:test/${created.length}`;
      expect(b.type).toBe('image/png');
      created.push(u);
      return u;
    };
    urls.revokeObjectURL = (u: string) => {
      revoked.push(u);
    };
    try {
      const user = userEvent.setup();
      mount();
      await user.click(await screen.findByText('pic.png'));
      const dialog = await screen.findByRole('dialog');
      const img = await waitFor(() => {
        const i = dialog.querySelector('img');
        if (!i) throw new Error('no image yet');
        return i;
      });
      expect(img.getAttribute('src')).toBe(created.at(-1));
      expect(img.getAttribute('alt')).toBe('pic.png');
      expect(dialog.textContent).toContain('PNG image');
      expect(dialog.textContent).not.toContain('Binary file');
      await user.keyboard('{Escape}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(revoked).toEqual(created);
    } finally {
      urls.createObjectURL = original.create;
      urls.revokeObjectURL = original.revoke;
    }
  });

  it('shows an SVG as its source, never as an image', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByText('logo.svg'));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.textContent).toContain('<script>'));
    expect(dialog.querySelector('img, iframe, object, embed')).toBeNull();
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

describe('sniffMedia', () => {
  const bytes = (...parts: (string | number[])[]) =>
    new Uint8Array(
      parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)),
    );

  it('reads what the bytes say, whatever the name', () => {
    expect(sniffMedia(PNG)).toEqual({ media: 'image', type: 'image/png' });
    expect(sniffMedia(bytes([0xff, 0xd8, 0xff, 0xe0]))?.type).toBe('image/jpeg');
    expect(sniffMedia(bytes('GIF89a'))?.type).toBe('image/gif');
    expect(sniffMedia(bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8 '))?.type).toBe('image/webp');
    expect(sniffMedia(bytes('RIFF', [0, 0, 0, 0], 'WAVEfmt '))?.type).toBe('audio/wav');
    expect(sniffMedia(bytes('%PDF-1.7\n'))).toEqual({ media: 'pdf', type: 'application/pdf' });
    expect(sniffMedia(bytes('ID3', [4, 0, 0]))).toMatchObject({ media: 'audio' });
    expect(sniffMedia(bytes([0xff, 0xfb, 0x90, 0x64]))?.type).toBe('audio/mpeg');
    expect(sniffMedia(bytes('OggS', [0, 2]))).toMatchObject({ media: 'audio' });
    expect(sniffMedia(bytes([0x1a, 0x45, 0xdf, 0xa3]))?.type).toBe('video/webm');
    expect(sniffMedia(bytes([0, 0, 0, 0x20], 'ftypisom'))?.type).toBe('video/mp4');
    expect(sniffMedia(bytes([0, 0, 0, 0x20], 'ftypM4A '))?.type).toBe('audio/mp4');
  });

  it('leaves text, SVG, a UTF-16 byte-order mark and an undrawable HEIC alone', () => {
    expect(sniffMedia(bytes('hello world'))).toBeNull();
    expect(sniffMedia(bytes('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBeNull();
    expect(sniffMedia(bytes([0xff, 0xfe, 0x68, 0x00]))).toBeNull();
    expect(sniffMedia(bytes([0, 0, 0, 0x18], 'ftypheic'))).toBeNull();
    expect(sniffMedia(bytes('RIFF', [0, 0, 0, 0], 'AVI LIST'))).toBeNull();
  });

  it('decodes everything else as text, and still calls a NUL binary', () => {
    expect(previewOfBytes(new TextEncoder().encode('é\n'))).toMatchObject({
      kind: 'text',
      text: 'é\n',
    });
    expect(previewOfBytes(bytes('PK', [3, 4, 0, 0]))).toEqual({ kind: 'binary' });
  });
});

describe('isMarkdown', () => {
  it('offers a rendered view for markdown only', () => {
    expect(isMarkdown('notes/plan.md')).toBe(true);
    expect(isMarkdown('README.MARKDOWN')).toBe(true);
    expect(isMarkdown('page.html')).toBe(false);
    expect(isMarkdown('doc.mdx')).toBe(false);
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
