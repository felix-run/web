// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { PaneDivider } from '../src/components/pane/pane-divider';
import { SidePane } from '../src/components/pane/side-pane';
import { ThemeProvider } from '../src/components/theme-provider';
import { WorkspaceSection } from '../src/components/workspace/workspace-section';
import {
  isMarkdown,
  languageFor,
  PREVIEW_LIMIT,
  previewOf,
  previewOfBytes,
  sniffMedia,
} from '../src/lib/file-preview';
import { resetPresence } from '../src/lib/presence';
import {
  closePaneItem,
  openInPane,
  PANE_LIMIT,
  paneState,
  resetPanes,
  updatePaneFile,
} from '../src/lib/side-pane';
import { ShellProvider, type ShellValue } from '../src/shell-context';

/**
 * What the operator opens beside the conversation.
 *
 * A workspace file is read from the same store, with the same precedence, as the
 * approval diff, so the store is a double here and what is pinned is which file
 * is read, what each of its states says, that media is drawn as itself (and its
 * object URL let go), and that HTML and SVG stay source. Then the editing: a
 * save goes to the store, an edit survives a tab switch, an agent's write under
 * an edit stops on a choice rather than merging, and a save over a file the run
 * in flight wrote asks first. And the shell: the pane takes the instrument's
 * zone where the instrument is a column, and gives it back.
 */

const files = vi.hoisted(() => ({
  tree: [
    'd notes',
    'f notes/plan.md',
    'f data.bin',
    'f pic.png',
    'f logo.svg',
    'f app.ts',
  ] as string[],
  body: {} as Record<string, string | Uint8Array>,
  read: vi.fn(async (_p: string) => null as Uint8Array | null),
  write: vi.fn(async (_p: string, _c: string) => {}),
}));

vi.mock('../src/lib/cowork', () => ({
  getMountLabel: () => null,
  hasMount: () => false,
  mountTree: async () => [],
  vfs: { tree: () => files.tree, read: () => '', write: () => {} },
  readWorkspaceBytes: files.read,
  readWorkspaceFile: async () => null,
  writeWorkspaceFile: files.write,
  executeClientTool: async () => ({ ok: true }),
  restoreMount: async () => ({ status: 'none' }),
  reconnectMount: async () => null,
  pickDirectory: async () => 'x',
  clearMount: () => {},
  supportsDirectoryPicker: () => false,
  collectTouchedPaths: () => [],
}));

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const THREAD = 'now';

/** The sidebar's tree and the pane, under one partial shell, as the workbench pairs them. */
function mount({
  streaming = false,
  runPaths = new Set<string>(),
}: {
  streaming?: boolean;
  runPaths?: Set<string>;
} = {}) {
  const value = {
    turns: [],
    threadId: THREAD,
    streaming,
    openInPane: (item: Parameters<NonNullable<ShellValue['openInPane']>>[0]) =>
      openInPane(THREAD, item),
  } as unknown as ShellValue;
  const tree = (s: boolean) => (
    <TooltipProvider>
      <ShellProvider value={{ ...value, streaming: s }}>
        <WorkspaceSection />
        <SidePane threadId={THREAD} changedPaths={new Set()} runPaths={runPaths} streaming={s} />
      </ShellProvider>
    </TooltipProvider>
  );
  const view = render(tree(streaming));
  return { ...view, setStreaming: (s: boolean) => view.rerender(tree(s)) };
}

const pane = () => document.querySelector<HTMLElement>('[data-slot="side-pane"]');
async function openedPane(): Promise<HTMLElement> {
  return waitFor(() => {
    const el = pane();
    if (!el) throw new Error('no pane yet');
    return el;
  });
}

beforeEach(() => {
  files.body = {
    'notes/plan.md': '# Plan\n\nShip the preview.\n',
    'data.bin': 'PK\u0003\u0004\u0000\u0000binary',
    'pic.png': PNG,
    'logo.svg': '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>\n',
    'app.ts': 'const a = 1;\n',
  };
  files.read.mockImplementation(async (p: string) => {
    const body = files.body[p];
    if (body === undefined) return null;
    return typeof body === 'string' ? new TextEncoder().encode(body) : body;
  });
  files.write.mockImplementation(async (p: string, c: string) => {
    files.body[p] = c;
  });
  localStorage.clear();
  sessionStorage.clear();
  resetPanes();
  // Files starts folded; these are about what opens from the tree.
  localStorage.setItem('felix.sidebar.filesOpen', '1');
});
afterEach(() => {
  cleanup();
  files.read.mockReset();
  files.write.mockReset();
});

describe('a workspace file in the pane', () => {
  it('opens from the tree, read from the workspace store', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'notes' }));
    await user.click(await screen.findByText('plan.md'));
    const el = await openedPane();
    expect(files.read).toHaveBeenCalledWith('notes/plan.md');
    expect(el.textContent).toContain('notes/plan.md');
    await waitFor(() => expect(el.textContent).toContain('Ship the preview.'));
    expect(el.textContent).toContain('3 lines');
    // A tab per open item, from the primitive.
    expect(screen.getByRole('tab', { name: /plan\.md/ }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('renders markdown, with its source and the editor a switch away', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'notes' }));
    await user.click(await screen.findByText('plan.md'));
    const el = await openedPane();
    const heading = await waitFor(() => {
      const h = el.querySelector('h1');
      if (!h) throw new Error('not rendered yet');
      return h;
    });
    expect(heading.textContent).toBe('Plan');
    expect(screen.getByRole('button', { name: 'Rendered' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Source' }));
    await waitFor(() => expect(el.textContent).toContain('# Plan'));
    expect(el.querySelector('h1')).toBeNull();
    expect(screen.getByRole('button', { name: 'Edit' })).toBeTruthy();
  });

  it('draws an image as itself, and lets its object URL go when its tab closes', async () => {
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
      const el = await openedPane();
      const img = await waitFor(() => {
        const i = el.querySelector('img');
        if (!i) throw new Error('no image yet');
        return i;
      });
      expect(img.getAttribute('src')).toBe(created.at(-1));
      expect(img.getAttribute('alt')).toBe('pic.png');
      expect(el.textContent).toContain('PNG image');
      expect(el.textContent).not.toContain('Binary file');
      await user.click(screen.getByRole('button', { name: 'Close pic.png' }));
      await waitFor(() => expect(pane()).toBeNull());
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
    const el = await openedPane();
    await waitFor(() => expect(el.textContent).toContain('<script>'));
    expect(el.querySelector('img, iframe, object, embed')).toBeNull();
  });

  it('says a binary file is binary rather than drawing it', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByText('data.bin'));
    const el = await openedPane();
    await waitFor(() => expect(el.textContent).toContain('Binary file'));
    expect(el.textContent).not.toContain('PK');
  });

  it('says a file that is not there is not there', async () => {
    delete files.body['notes/plan.md'];
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'notes' }));
    await user.click(await screen.findByText('plan.md'));
    const el = await openedPane();
    await waitFor(() => expect(el.textContent).toContain('not in the workspace'));
  });

  it('folds a folder by its name, and opens nothing for it', async () => {
    const user = userEvent.setup();
    mount();
    const folder = await screen.findByRole('button', { name: 'notes' });
    await user.click(folder);
    expect(await screen.findByText('plan.md')).toBeTruthy();
    expect(pane()).toBeNull();
    expect(files.read).not.toHaveBeenCalled();
  });
});

/** Open app.ts in the editor, and type into it. */
async function editAppTs(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(await screen.findByText('app.ts'));
  await openedPane();
  await user.click(await screen.findByRole('button', { name: 'Edit' }));
  const field = await screen.findByRole('textbox', { name: 'app.ts source' });
  fireEvent.change(field, { target: { value: text } });
  return field;
}

describe('editing a workspace file', () => {
  it('saves to the store the tools use, and says the agent is not told', async () => {
    const user = userEvent.setup();
    mount();
    await editAppTs(user, 'const a = 2;\n');
    expect(screen.getByRole('tab', { name: /app\.ts.*unsaved/ })).toBeTruthy();
    expect(pane()?.textContent).toContain("The agent isn't told");
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(files.write).toHaveBeenCalledWith('app.ts', 'const a = 2;\n'));
    await waitFor(() => expect(screen.queryByRole('tab', { name: /unsaved/ })).toBeNull());
    expect(pane()?.textContent).toContain('Saved.');
  });

  it('keeps an edit across a tab switch, since an inactive tab unmounts', async () => {
    const user = userEvent.setup();
    mount();
    await editAppTs(user, 'const a = 3;\n');
    await user.click(await screen.findByText('logo.svg'));
    await user.click(screen.getByRole('tab', { name: /app\.ts/ }));
    const field = await screen.findByRole('textbox', { name: 'app.ts source' });
    expect((field as HTMLTextAreaElement).value).toBe('const a = 3;\n');
  });

  it('stops on a choice when the agent writes the file under an edit', async () => {
    const user = userEvent.setup();
    const view = mount({ streaming: true });
    await editAppTs(user, 'const a = 4;\n');
    files.body['app.ts'] = 'const a = 1;\nconst agent = true;\n';
    // The run settles: the file is read again.
    view.setStreaming(false);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The agent changed this file');
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);

    await user.click(screen.getByRole('button', { name: 'Keep my edits' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(files.write).toHaveBeenCalledWith('app.ts', 'const a = 4;\n'));
  });

  it("takes the agent's version, dropping the edit", async () => {
    const user = userEvent.setup();
    const view = mount({ streaming: true });
    await editAppTs(user, 'const a = 5;\n');
    files.body['app.ts'] = 'const agent = true;\n';
    view.setStreaming(false);
    await user.click(await screen.findByRole('button', { name: "Take the agent's version" }));
    const field = await screen.findByRole('textbox', { name: 'app.ts source' });
    await waitFor(() => expect((field as HTMLTextAreaElement).value).toBe('const agent = true;\n'));
    expect(files.write).not.toHaveBeenCalled();
  });

  it('asks before saving over a file the run in flight wrote', async () => {
    const user = userEvent.setup();
    mount({ streaming: true, runPaths: new Set(['app.ts']) });
    await editAppTs(user, 'const a = 6;\n');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(files.write).not.toHaveBeenCalled();
    expect(pane()?.textContent).toContain('The running agent wrote this file in this run');
    await user.click(screen.getByRole('button', { name: 'Save anyway' }));
    await waitFor(() => expect(files.write).toHaveBeenCalledWith('app.ts', 'const a = 6;\n'));
  });

  it('asks before closing a tab that holds an edit', async () => {
    const user = userEvent.setup();
    mount();
    await editAppTs(user, 'const a = 7;\n');
    await user.click(screen.getByRole('button', { name: 'Close app.ts' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Unsaved edits' });
    expect(ask.textContent).toContain('Discard your edits to app.ts?');
    await user.click(screen.getByRole('button', { name: 'Keep editing' }));
    expect(paneState(THREAD).items).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Close app.ts' }));
    await user.click(await screen.findByRole('button', { name: 'Discard' }));
    await waitFor(() => expect(pane()).toBeNull());
  });
});

describe('the pane store', () => {
  it('keeps the newest few, letting the oldest clean one go first', () => {
    openInPane(THREAD, { kind: 'file', path: 'edited.ts' });
    // An edit is never what makes room.
    updatePaneFile(THREAD, 'file:edited.ts', (i) => ({ ...i, draft: 'b', base: 'a' }));
    for (let i = 0; i < PANE_LIMIT; i++) openInPane(THREAD, { kind: 'file', path: `f${i}.ts` });
    const keys = paneState(THREAD).items.map((i) => i.key);
    expect(keys).toHaveLength(PANE_LIMIT);
    expect(keys).toContain('file:edited.ts');
    expect(keys).not.toContain('file:f0.ts');
    expect(paneState(THREAD).active).toBe(`file:f${PANE_LIMIT - 1}.ts`);
  });

  it('activates rather than duplicates, and closing hands focus to the neighbour', () => {
    openInPane(THREAD, { kind: 'file', path: 'a' });
    openInPane(THREAD, { kind: 'file', path: 'b' });
    openInPane(THREAD, { kind: 'file', path: 'c' });
    openInPane(THREAD, { kind: 'file', path: 'b' });
    expect(paneState(THREAD).items.map((i) => i.key)).toEqual(['file:a', 'file:b', 'file:c']);
    closePaneItem(THREAD, 'file:b');
    expect(paneState(THREAD).active).toBe('file:c');
  });

  it('comes back from session storage, per thread', () => {
    openInPane(THREAD, { kind: 'code', code: 'echo hi', language: 'bash', title: 'bash · 1 line' });
    openInPane('other', { kind: 'file', path: 'x' });
    resetPanes();
    expect(paneState(THREAD).items.map((i) => i.kind)).toEqual(['code']);
    expect(paneState('other').items.map((i) => i.kind)).toEqual(['file']);
  });
});

describe('the divider', () => {
  function Harness() {
    const [share, setShare] = useState(0.4);
    return (
      <div>
        <PaneDivider
          share={share}
          min={0.3}
          max={0.7}
          onChange={setShare}
          onCommit={setShare}
          onReset={() => setShare(0.46)}
          controls="side-pane"
        />
      </div>
    );
  }

  it('is a splitter the keyboard moves, within its limits', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const sep = screen.getByRole('separator', { name: 'Resize the side pane' });
    expect(sep.getAttribute('aria-valuenow')).toBe('40');
    sep.focus();
    await user.keyboard('{ArrowLeft}');
    expect(sep.getAttribute('aria-valuenow')).toBe('42');
    await user.keyboard('{Shift>}{ArrowRight}{/Shift}');
    expect(sep.getAttribute('aria-valuenow')).toBe('32');
    await user.keyboard('{Home}');
    expect(sep.getAttribute('aria-valuenow')).toBe('70');
    await user.keyboard('{Enter}');
    expect(sep.getAttribute('aria-valuenow')).toBe('46');
  });
});

describe('the pane and the instrument', () => {
  /**
   * Where the instrument is a column, the pane takes its zone and the instrument
   * reads closed; opening the instrument hands the zone back with the pane's
   * tabs kept, and closing the pane brings the instrument back as it stood.
   */
  beforeEach(() => {
    vi.stubGlobal('matchMedia', (query: string) => {
      const min = Number(/min-width:\s*(\d+)px/.exec(query)?.[1]);
      return {
        matches: Number.isFinite(min) && 1440 >= min,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      };
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ items: [], requests: [], sessions: [] }))),
    );
    resetPresence();
    localStorage.setItem('felix.debug', '1');
    localStorage.setItem('felix.inspectorOpen', '1');
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  const toggle = () =>
    document.querySelector<HTMLElement>('header [aria-label="This thread"]') as HTMLElement;
  const instrument = () => document.querySelector('[data-rail="right"][data-state="open"]');

  it('takes the zone, gives it back, and keeps its tabs', async () => {
    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/t/zone']}>
          <ThemeProvider>
            <TooltipProvider>
              <App />
            </TooltipProvider>
          </ThemeProvider>
        </MemoryRouter>
      </StrictMode>,
    );
    await waitFor(() => expect(instrument()).not.toBeNull());
    const user = userEvent.setup();

    act(() => openInPane('zone', { kind: 'file', path: 'app.ts' }));
    await openedPane();
    await waitFor(() => expect(instrument()).toBeNull());
    expect(toggle().getAttribute('aria-pressed')).toBe('false');

    // The instrument's toggle takes the zone back; the pane keeps its tab.
    await user.click(toggle());
    await waitFor(() => expect(instrument()).not.toBeNull());
    expect(pane()).toBeNull();
    expect(paneState('zone').items).toHaveLength(1);

    // Opening something again brings the pane back over it.
    act(() => openInPane('zone', { kind: 'file', path: 'app.ts' }));
    await openedPane();
    await waitFor(() => expect(instrument()).toBeNull());

    // Closing the pane returns the zone to the instrument as it stood.
    await user.click(screen.getByRole('button', { name: 'Close the pane' }));
    await waitFor(() => expect(pane()).toBeNull());
    await waitFor(() => expect(instrument()).not.toBeNull());
    expect(localStorage.getItem('felix.inspectorOpen')).toBe('1');
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
