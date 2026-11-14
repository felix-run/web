// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkillLibrary, SkillLibraryPage } from '../src/components/skills/skill-library';
import { fakeHarness, mountWithProviders, versionRow } from './skill-fixtures';

/**
 * An administrator's view of other people's personal libraries: listed only on request, because
 * every listing is audited, and opened read-only — readable and archivable, nothing more.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const LIB = 'a'.repeat(32);

const teamRoutes = (path: string) =>
  path.startsWith('/skill-library?') || path.startsWith('/skill-library/-/review')
    ? { body: { items: [], next_cursor: null } }
    : undefined;

describe('Personal libraries, for an administrator', () => {
  it('lists them only when asked, and links each to its read-only view', async () => {
    const h = fakeHarness((req) =>
      req.path === '/skill-library/-/personal'
        ? {
            body: {
              items: [{ library: `~${LIB}`, owner: 'https://github.com|octocat', skills: 3 }],
              truncated: false,
            },
          }
        : teamRoutes(req.path),
    );
    mountWithProviders(<SkillLibrary />, '/harness/skills');
    // Behind Manage, closed by default; opening it still lists nothing until Show.
    const manage = await screen.findByRole('button', { name: 'Manage' });
    expect(manage.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('button', { name: 'Show' })).toBeNull();
    fireEvent.click(manage);
    const show = await screen.findByRole('button', { name: 'Show' });
    expect(screen.getByText(/recorded in the audit log/)).toBeTruthy();
    expect(h.requests.some((r) => r.path === '/skill-library/-/personal')).toBe(false);

    fireEvent.click(show);
    const link = await screen.findByRole('link', { name: 'octocat' });
    expect(link.getAttribute('href')).toContain(`lib=${LIB}`);
    expect(screen.getByText('3 skills')).toBeTruthy();
    expect(screen.getByText('https://github.com')).toBeTruthy();
  });

  it('names the owner of a library opened from the list, without asking again', async () => {
    const h = fakeHarness((req) => {
      if (req.path === '/skill-library/-/personal') {
        return {
          body: {
            items: [{ library: `~${LIB}`, owner: 'https://github.com|octocat', skills: 0 }],
            truncated: false,
          },
        };
      }
      if (req.path.startsWith(`/skill-library/~${LIB}?`)) {
        return { body: { items: [], next_cursor: null } };
      }
      return teamRoutes(req.path);
    });
    mountWithProviders(<SkillLibrary />, '/harness/skills');
    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show' }));
    fireEvent.click(await screen.findByRole('link', { name: 'octocat' }));
    expect(await screen.findByText('octocat’s skills')).toBeTruthy();
    expect(screen.getByText('read-only · https://github.com')).toBeTruthy();
    expect(h.requests.filter((r) => r.path === '/skill-library/-/personal')).toHaveLength(1);
  });

  it('says only an administrator can list them when the key is refused', async () => {
    fakeHarness((req) =>
      req.path === '/skill-library/-/personal'
        ? { status: 403, body: { detail: 'Forbidden' } }
        : teamRoutes(req.path),
    );
    mountWithProviders(<SkillLibrary />, '/harness/skills');
    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show' }));
    expect(
      await screen.findByText('Only an administrator can list personal libraries.'),
    ).toBeTruthy();
  });

  it('shows nothing on a harness without the route', async () => {
    fakeHarness((req) => teamRoutes(req.path));
    mountWithProviders(<SkillLibrary />, '/harness/skills');
    fireEvent.click(await screen.findByRole('button', { name: 'Manage' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Show' }));
    await waitFor(() => expect(screen.queryByText('Personal libraries')).toBeNull());
  });

  it('opens someone else’s library read-only, at its own routes', async () => {
    const h = fakeHarness((req) =>
      req.path.startsWith(`/skill-library/~${LIB}?`)
        ? { body: { items: [], next_cursor: null } }
        : undefined,
    );
    mountWithProviders(<SkillLibrary />, `/harness/skills?lib=${LIB}`);
    expect(await screen.findByText('A personal library')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /New skill/ })).toBeNull();
    expect(screen.queryByText('Waiting for review')).toBeNull();
    for (const name of ['Team library', 'My skills']) {
      expect(screen.getByRole('link', { name }).getAttribute('aria-current')).toBeNull();
    }
    await waitFor(() =>
      expect(h.requests.some((r) => r.path.startsWith(`/skill-library/~${LIB}?`))).toBe(true),
    );
  });

  it('offers no edit, publish, reject or rollback there — only archive', async () => {
    const draft = versionRow({ name: 'their-notes', version: '1.1.0', status: 'draft' });
    const live = versionRow({
      name: 'their-notes',
      version: '1.0.0',
      status: 'published',
      published_at: Date.now() - 1000,
    });
    fakeHarness((req) =>
      req.method === 'GET' && req.path === `/skill-library/~${LIB}/their-notes`
        ? {
            body: {
              name: 'their-notes',
              live_version: '1.0.0',
              created_by: 'someone',
              created_at: 1,
              updated_at: 1,
              shadows_operator_upload: false,
              versions: [draft, live],
              upstream: null,
            },
          }
        : undefined,
    );
    mountWithProviders(
      <SkillLibraryPage />,
      `/harness/skills?lib=${LIB}&skill=their-notes&tab=edit`,
    );
    expect(await screen.findByRole('button', { name: /Archive skill/ })).toBeTruthy();
    // The way back is the owner's: the administrator here cannot roll back.
    expect(screen.getByText(/the owner can bring the skill back/)).toBeTruthy();
    expect(screen.queryByText(/rolling back to one brings/)).toBeNull();
    // An address naming Edit opens Versions instead, and there is no Edit tab to choose.
    expect(screen.getByRole('tab', { name: 'Versions' }).getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(screen.queryByRole('tab', { name: 'Edit' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Publish/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Reject/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Roll back/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Promote/ })).toBeNull();
  });
});
