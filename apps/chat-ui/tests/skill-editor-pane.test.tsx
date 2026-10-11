// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SidePane } from '../src/components/pane/side-pane';
import { SkillLibraryPage } from '../src/components/skills/skill-library';
import { openInPane, paneState, resetPanes } from '../src/lib/side-pane';
import {
  fakeHarness,
  fileBody,
  mountWithProviders,
  PaneShell,
  SKILL_MD,
  versionRow,
} from './skill-fixtures';

/**
 * A skill is edited in the side pane, beside a conversation, and nowhere else: the skill page
 * has an Edit control rather than an Edit tab, and the pane draws a skill as a tab of its own.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetPanes();
  sessionStorage.clear();
});

const TEXT = SKILL_MD('roll-dice', '# Steps\n\n1. Roll.\n');

function harness(base = '/skill-library') {
  return fakeHarness((req) => {
    if (req.path === `${base}/roll-dice`) {
      return {
        body: {
          name: 'roll-dice',
          live_version: '0.1.0',
          created_by: 'op',
          created_at: 1,
          updated_at: 1,
          shadows_operator_upload: false,
          versions: [versionRow({ version: '0.1.0', status: 'published' })],
          upstream: null,
        },
      };
    }
    if (req.path === `${base}/roll-dice/versions/0.1.0`) {
      return {
        body: {
          ...versionRow({ version: '0.1.0', status: 'published' }),
          review_checks: [],
          security_issues: [],
          files: [{ path: 'SKILL.md', sha256: 'a', size: 1 }],
          shadows_operator_upload: false,
        },
      };
    }
    if (req.path === `${base}/roll-dice/versions/0.1.0/files/SKILL.md`) {
      return { body: fileBody('SKILL.md', TEXT) };
    }
    return undefined;
  });
}

describe('the skill editor in the side pane', () => {
  it('opens from the skill page’s Edit, which is no longer a tab', async () => {
    harness();
    mountWithProviders(
      <PaneShell>
        <SkillLibraryPage />
      </PaneShell>,
      '/harness/skills?skill=roll-dice&tab=edit',
    );
    // An old `tab=edit` link opens Versions.
    expect(
      (await screen.findByRole('tab', { name: 'Versions' })).getAttribute('aria-selected'),
    ).toBe('true');
    expect(screen.queryByRole('tab', { name: 'Edit' })).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }));
    const pane = await screen.findByRole('region', { name: 'Side pane' });
    const source = (await within(pane).findByLabelText('SKILL.md source')) as HTMLTextAreaElement;
    await waitFor(() => expect(source.value).toBe(TEXT));
    expect(paneState('t').items.map((i) => i.key)).toEqual(['skill:/roll-dice']);
  });

  it('offers no Edit in someone else’s library', async () => {
    const lib = 'c'.repeat(32);
    harness(`/skill-library/~${lib}`);
    mountWithProviders(
      <PaneShell>
        <SkillLibraryPage />
      </PaneShell>,
      `/harness/skills?lib=${lib}&skill=roll-dice`,
    );
    expect(await screen.findByRole('button', { name: /Archive skill/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('is a tab of the pane, named for the skill, marked while it holds an edit', async () => {
    harness();
    openInPane('t', { kind: 'skill', name: 'roll-dice' });
    mountWithProviders(
      <SidePane threadId="t" changedPaths={new Set()} runPaths={new Set()} streaming={false} />,
    );
    const tab = screen.getByRole('tab', { name: /roll-dice/ });
    expect(tab.getAttribute('aria-selected')).toBe('true');
    const source = (await screen.findByLabelText('SKILL.md source')) as HTMLTextAreaElement;
    await waitFor(() => expect(source.value).toBe(TEXT));
    fireEvent.change(source, { target: { value: `${TEXT}2. Read it.\n` } });
    await waitFor(() => expect(tab.textContent).toContain('unsaved'));
  });
});
