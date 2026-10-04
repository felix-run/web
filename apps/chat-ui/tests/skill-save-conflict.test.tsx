// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkillLibraryPage } from '../src/components/skills/skill-library';
import { fakeHarness, fileBody, mountWithProviders, SKILL_MD, versionRow } from './skill-fixtures';

/**
 * Saving over a version someone else saved first.
 *
 * `PUT …/versions` names the version the editor loaded as `parent_version`,
 * and the harness answers 409 `parent_changed` when a newer one exists. The
 * one thing the editor must never do then is pick for the operator: not
 * silently retry against the newer parent (which would overwrite its changes),
 * and not silently drop the edits. Both choices are pinned at the wire — the
 * second save's `parent_version`, and what the editor holds after a reload.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const ORIGINAL = SKILL_MD('roll-dice', '# Steps\n\n1. Roll.\n');
const THEIRS = SKILL_MD('roll-dice', '# Steps\n\n1. Roll two dice.\n');

interface Options {
  /** 0.1.1 also changed, added and deleted files other than SKILL.md. */
  upstreamFiles?: boolean;
  /** The re-read after the 409 fails. */
  rereadFails?: boolean;
  /** The re-read after the 409 still names 0.1.0 as newest (a lagging read). */
  rereadStale?: boolean;
}

/** Bundles by version: path → [content, sha256]. */
function bundles(opts: Options): Record<string, Record<string, [string, string]>> {
  const base: Record<string, [string, string]> = { 'SKILL.md': [ORIGINAL, 'o'] };
  const theirs: Record<string, [string, string]> = { 'SKILL.md': [THEIRS, 't'] };
  if (opts.upstreamFiles) {
    base['references/a.md'] = ['# A\nold\n', 'a1'];
    base['references/gone.md'] = ['# Gone\n', 'g1'];
    base['references/same.md'] = ['# Same\n', 's1'];
    theirs['references/a.md'] = ['# A\nnew\n', 'a2'];
    theirs['scripts/new.sh'] = ['echo new\n', 'n1'];
    theirs['references/same.md'] = ['# Same\n', 's1'];
  }
  return { '0.1.0': base, '0.1.1': theirs };
}

function harness(opts: Options = {}) {
  let theirsSaved = false;
  let puts = 0;
  const stored = bundles(opts);
  const h = fakeHarness((req) => {
    const versions = theirsSaved
      ? [
          versionRow({ version: '0.1.1', parent_version: '0.1.0', source: 'operator' }),
          versionRow(),
        ]
      : [versionRow()];
    if (req.method === 'GET' && req.path === '/skill-library/roll-dice') {
      if (theirsSaved && opts.rereadFails)
        return { status: 503, body: { error: 'down', message: 'x' } };
      return {
        body: {
          name: 'roll-dice',
          live_version: null,
          created_by: 'quick',
          created_at: 1,
          updated_at: 2,
          shadows_operator_upload: false,
          versions: opts.rereadStale ? [versionRow()] : versions,
        },
      };
    }
    const detail = /^\/skill-library\/roll-dice\/versions\/(\d+\.\d+\.\d+)$/.exec(req.path);
    if (req.method === 'GET' && detail) {
      const files = stored[detail[1] ?? ''] ?? {};
      return {
        body: {
          ...versionRow({ version: detail[1] }),
          review_checks: [],
          security_issues: [],
          files: Object.entries(files).map(([path, [, sha]]) => ({ path, sha256: sha, size: 1 })),
          shadows_operator_upload: false,
        },
      };
    }
    const file = /^\/skill-library\/roll-dice\/versions\/(\d+\.\d+\.\d+)\/files\/(.+)$/.exec(
      req.path,
    );
    if (req.method === 'GET' && file) {
      const [, v = '', path = ''] = file;
      // The harness redacts on read; a saved version read back says so.
      if (v === '0.1.2') return { body: fileBody(path, '[REDACTED]') };
      const entry = stored[v]?.[path];
      return entry ? { body: fileBody(path, entry[0]) } : undefined;
    }
    if (req.method === 'PUT' && req.path === '/skill-library/roll-dice/versions') {
      puts++;
      if (puts === 1) {
        // Someone else's save landed between this editor's load and its save.
        theirsSaved = true;
        return {
          status: 409,
          body: { error: 'parent_changed', message: 'roll-dice has a newer version than 0.1.0' },
        };
      }
      const sent = (req.body as { files: Record<string, string> }).files;
      stored['0.1.2'] = Object.fromEntries(
        Object.entries(sent).map(([p, c]) => [p, [c, `x${c.length}`]]),
      );
      return {
        status: 201,
        body: {
          ...versionRow({ version: '0.1.2', parent_version: '0.1.1' }),
          review_checks: [],
          security_issues: [],
          files: Object.keys(sent).map((path) => ({ path, sha256: 'b', size: 1 })),
          shadows_operator_upload: false,
          published: false,
          publish_blocked: null,
        },
      };
    }
    return undefined;
  });
  return h;
}

async function editAndSave() {
  const source = (await screen.findByLabelText('SKILL.md source')) as HTMLTextAreaElement;
  await waitFor(() => expect(source.value).toBe(ORIGINAL));
  fireEvent.change(source, { target: { value: `${ORIGINAL}2. Read the total.\n` } });
  fireEvent.click(screen.getByRole('button', { name: /Save version/ }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Save 0.1.1' }));
}

const AT = '/harness/skills?skill=roll-dice&tab=edit';

describe('an unchanged bundle', () => {
  it('offers no save until something changes, so no version is minted as a copy', async () => {
    const h = harness();
    mountWithProviders(<SkillLibraryPage />, AT);
    const source = (await screen.findByLabelText('SKILL.md source')) as HTMLTextAreaElement;
    await waitFor(() => expect(source.value).toBe(ORIGINAL));
    const save = screen.getByRole('button', { name: /Save version/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    // The shortcut is refused too, and says why rather than opening a dialog.
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.change(source, { target: { value: `${ORIGINAL}2. Read the total.\n` } });
    expect(save.disabled).toBe(false);
    expect(h.requests.filter((r) => r.method === 'PUT')).toHaveLength(0);
  });
});

describe('a stale save', () => {
  it('stops at a choice, having saved nothing', async () => {
    const h = harness();
    mountWithProviders(<SkillLibraryPage />, AT);
    await editAndSave();
    const alert = await screen.findByText(/Someone saved a newer version while you were editing/);
    expect(alert.textContent).toContain('Nothing was saved');
    expect(
      await screen.findByRole('button', { name: /Keep my edits, review 0\.1\.1/ }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: /Discard my edits, load 0\.1\.1/ })).toBeTruthy();
    // The first save named the version it was loaded from, and nothing retried it.
    const puts = h.requests.filter((r) => r.method === 'PUT');
    expect(puts).toHaveLength(1);
    expect((puts[0]?.body as { parent_version: string }).parent_version).toBe('0.1.0');
  });

  it('keeping the edits shows what the newer version changed, then saves on top of it', async () => {
    const h = harness();
    mountWithProviders(<SkillLibraryPage />, AT);
    await editAndSave();
    fireEvent.click(await screen.findByRole('button', { name: /Keep my edits, review 0\.1\.1/ }));
    // Their line, which the next save would undo, is on screen before the save.
    expect(await screen.findByText(/1\. Roll two dice\./)).toBeTruthy();
    expect(screen.getByText(/Saving over 0\.1\.1/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Save version/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save 0.1.2' }));
    await waitFor(() => expect(h.requests.filter((r) => r.method === 'PUT')).toHaveLength(2));
    const second = h.requests.filter((r) => r.method === 'PUT')[1]?.body as {
      parent_version: string;
      files: Record<string, string>;
    };
    expect(second.parent_version).toBe('0.1.1');
    expect(second.files['SKILL.md']).toContain('2. Read the total.');
  });

  it('reloading discards the edits for the newer version', async () => {
    harness();
    mountWithProviders(<SkillLibraryPage />, AT);
    await editAndSave();
    fireEvent.click(await screen.findByRole('button', { name: /Discard my edits, load 0\.1\.1/ }));
    const source = (await screen.findByLabelText('SKILL.md source')) as HTMLTextAreaElement;
    await waitFor(() => expect(source.value).toBe(THEIRS));
    expect(screen.queryByText(/unsaved changes/)).toBeNull();
    expect(document.body.textContent).toContain('Editing from 0.1.1');
  });

  it('lists every other file the newer version changed, and holds the save until each is decided', async () => {
    const h = harness({ upstreamFiles: true });
    mountWithProviders(<SkillLibraryPage />, AT);
    await editAndSave();
    fireEvent.click(await screen.findByRole('button', { name: /Keep my edits, review 0\.1\.1/ }));
    const list = await screen.findByRole('list', { name: 'Files 0.1.1 changed' });
    const rows = within(list)
      .getAllByRole('listitem')
      .map((r) => r.textContent ?? '');
    // An unchanged file is not listed; changed, added and deleted ones are.
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.includes('references/a.md'))).toContain('changed in 0.1.1');
    expect(rows.find((r) => r.includes('scripts/new.sh'))).toContain('added in 0.1.1');
    expect(rows.find((r) => r.includes('references/gone.md'))).toContain('deleted in 0.1.1');
    expect(screen.getByText(/3 still to choose before saving/)).toBeTruthy();

    // The save is held: no dialog, no request.
    fireEvent.click(screen.getByRole('button', { name: /Save version/ }));
    expect(screen.queryByRole('dialog')).toBeNull();

    // A diff on request, of what the newer version did to the file.
    const aRow = within(list)
      .getAllByRole('listitem')
      .find((r) => r.textContent?.includes('references/a.md')) as HTMLElement;
    fireEvent.click(within(aRow).getByRole('button', { name: 'Show diff' }));
    expect(within(aRow).getByText('new')).toBeTruthy();

    fireEvent.click(within(aRow).getByRole('button', { name: "Take 0.1.1's" }));
    const newRow = within(list)
      .getAllByRole('listitem')
      .find((r) => r.textContent?.includes('scripts/new.sh')) as HTMLElement;
    fireEvent.click(within(newRow).getByRole('button', { name: 'Keep mine' }));
    const goneRow = within(list)
      .getAllByRole('listitem')
      .find((r) => r.textContent?.includes('gone.md')) as HTMLElement;
    fireEvent.click(within(goneRow).getByRole('button', { name: 'Delete it, as 0.1.1' }));

    fireEvent.click(screen.getByRole('button', { name: /Save version/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save 0.1.2' }));
    await waitFor(() => expect(h.requests.filter((r) => r.method === 'PUT')).toHaveLength(2));
    const sent = (
      h.requests.filter((r) => r.method === 'PUT')[1]?.body as { files: Record<string, string> }
    ).files;
    expect(sent['references/a.md']).toBe('# A\nnew\n');
    expect(sent['scripts/new.sh']).toBeUndefined();
    expect(sent['references/gone.md']).toBeUndefined();
    expect(sent['references/same.md']).toBe('# Same\n');
    expect(sent['SKILL.md']).toContain('2. Read the total.');
  });

  it('names no version when the re-read after the refusal fails', async () => {
    harness({ rereadFails: true });
    mountWithProviders(<SkillLibraryPage />, AT);
    await editAndSave();
    expect(await screen.findByText(/The newer version could not be read/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Keep my edits/ })).toBeNull();
  });

  it('names no version when the re-read still says the refused parent is newest', async () => {
    harness({ rereadStale: true });
    mountWithProviders(<SkillLibraryPage />, AT);
    await editAndSave();
    expect(await screen.findByText(/The newer version could not be read/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: /0\.1\.0/ })).toBeNull();
  });

  it('keeps the saved text in the editor, not the redacted read of it', async () => {
    harness();
    mountWithProviders(<SkillLibraryPage />, AT);
    await editAndSave();
    fireEvent.click(await screen.findByRole('button', { name: /Keep my edits, review 0\.1\.1/ }));
    await screen.findByText(/changed no other file/);
    fireEvent.click(screen.getByRole('button', { name: /Save version/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save 0.1.2' }));
    await waitFor(() => expect(document.body.textContent).toContain('Editing from 0.1.2'));
    // Give any refetch of the new version's files the chance to land.
    await new Promise((r) => setTimeout(r, 50));
    const source = screen.getByLabelText('SKILL.md source') as HTMLTextAreaElement;
    expect(source.value).toContain('2. Read the total.');
    expect(source.value).not.toContain('[REDACTED]');
  });
});
