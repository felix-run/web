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

function harness() {
  let theirsSaved = false;
  let puts = 0;
  const h = fakeHarness((req) => {
    const versions = theirsSaved
      ? [
          versionRow({ version: '0.1.1', parent_version: '0.1.0', source: 'operator' }),
          versionRow(),
        ]
      : [versionRow()];
    if (req.method === 'GET' && req.path === '/skill-library/roll-dice') {
      return {
        body: {
          name: 'roll-dice',
          live_version: null,
          created_by: 'quick',
          created_at: 1,
          updated_at: 2,
          shadows_operator_upload: false,
          versions,
        },
      };
    }
    const detail = /^\/skill-library\/roll-dice\/versions\/(\d+\.\d+\.\d+)$/.exec(req.path);
    if (req.method === 'GET' && detail) {
      return {
        body: {
          ...versionRow({ version: detail[1] }),
          review_checks: [],
          security_issues: [],
          files: [{ path: 'SKILL.md', sha256: 'a', size: 1 }],
          shadows_operator_upload: false,
        },
      };
    }
    if (req.path === '/skill-library/roll-dice/versions/0.1.0/files/SKILL.md') {
      return { body: fileBody('SKILL.md', ORIGINAL) };
    }
    if (req.path === '/skill-library/roll-dice/versions/0.1.1/files/SKILL.md') {
      return { body: fileBody('SKILL.md', THEIRS) };
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
      return {
        status: 201,
        body: {
          ...versionRow({ version: '0.1.2', parent_version: '0.1.1' }),
          review_checks: [],
          security_issues: [],
          files: [{ path: 'SKILL.md', sha256: 'b', size: 1 }],
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
});
