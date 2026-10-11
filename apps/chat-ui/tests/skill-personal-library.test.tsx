// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkillLibrary, SkillLibraryPage } from '../src/components/skills/skill-library';
import { fakeHarness, mountWithProviders, versionRow } from './skill-fixtures';

/**
 * My skills (`?lib=me`): the caller's own library, on the same list, skill page and actions as
 * the team's, at the `~me` routes. The team's review queue, feedback, evaluations and policy are
 * not part of it, and a version once published can be promoted into the team library as a draft.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const summary = {
  name: 'my-notes',
  live_version: '1.0.0',
  latest: {
    version: '1.0.0',
    status: 'published',
    source: 'operator',
    quality_score: 80,
    security_status: 'pass',
    created_at: Date.now(),
  },
  pending_drafts: 0,
  shadows_operator_upload: false,
  created_by: 'me',
  created_at: Date.now(),
  updated_at: Date.now(),
};

const published = versionRow({
  name: 'my-notes',
  version: '1.0.0',
  status: 'published',
  source: 'operator',
  author: 'me',
  published_at: Date.now() - 1000,
});

describe('My skills', () => {
  it('lists the caller’s own library, without the team’s queue or policy', async () => {
    const h = fakeHarness((req) =>
      req.path.startsWith('/skill-library/~me?')
        ? { body: { items: [summary], next_cursor: null } }
        : undefined,
    );
    mountWithProviders(<SkillLibrary />, '/harness/skills?lib=me');
    expect(await screen.findByText('my-notes')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'My skills' }).getAttribute('aria-current')).toBe(
      'page',
    );
    expect(screen.queryByText('Waiting for review')).toBeNull();
    expect(screen.queryByText('Publish policy')).toBeNull();
    expect(h.requests.some((r) => r.path.startsWith('/skill-library/-/review'))).toBe(false);
  });

  it('says plainly when the sign-in has no personal library', async () => {
    fakeHarness((req) =>
      req.path.startsWith('/skill-library/~me')
        ? { status: 403, body: { detail: 'no_personal_library' } }
        : undefined,
    );
    mountWithProviders(<SkillLibrary />, '/harness/skills?lib=me');
    expect(await screen.findByText(/Your sign-in has no personal library/)).toBeTruthy();
  });

  it('drops the team-only tabs, and promotes a published version to the team as a draft', async () => {
    const h = fakeHarness((req) => {
      if (req.method === 'GET' && req.path === '/skill-library/~me/my-notes') {
        return {
          body: {
            name: 'my-notes',
            live_version: '1.0.0',
            created_by: 'me',
            created_at: 1,
            updated_at: 1,
            shadows_operator_upload: false,
            versions: [published],
            upstream: null,
          },
        };
      }
      if (req.path === '/skill-library/~me/my-notes/versions/1.0.0/promote') {
        return {
          status: 201,
          body: { name: 'my-notes', version: '0.1.0', status: 'draft', files: [] },
        };
      }
      return undefined;
    });
    mountWithProviders(<SkillLibraryPage />, '/harness/skills?lib=me&skill=my-notes&tab=evals');

    // An address naming a team-only tab opens Versions instead.
    fireEvent.click(await screen.findByRole('button', { name: /Promote to the team/ }));
    expect(screen.queryByRole('tab', { name: 'Evals' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Feedback' })).toBeNull();

    fireEvent.change(screen.getByLabelText(/Why the team should have it/), {
      target: { value: 'useful for everyone' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Promote 1.0.0' }));
    await waitFor(() =>
      expect(h.requests.find((r) => r.path.endsWith('/promote'))?.body).toEqual({
        reason: 'useful for everyone',
      }),
    );
    const link = await screen.findByRole('link', { name: 'Open it in the team library' });
    // The team library's address: no `lib`.
    expect(link.getAttribute('href')).toContain('skill=my-notes');
    expect(link.getAttribute('href')).not.toContain('lib=');
  });
});
