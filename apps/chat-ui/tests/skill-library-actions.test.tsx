// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkillLibrary, SkillLibraryPage } from '../src/components/skills/skill-library';
import {
  fakeHarness,
  fileBody,
  mountWithProviders,
  type Recorded,
  SKILL_MD,
  versionRow,
} from './skill-fixtures';

/**
 * The library's decisions at the wire — reject carries its note, rollback and
 * archive send their verbs, an approved draft leaves the queue — and the
 * unsaved-changes guard, mounted on a real data router, because `useBlocker`
 * does nothing under the `MemoryRouter` every other suite uses.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

type Row = Record<string, unknown>;

/** A one-skill library whose versions move as the routes are called. */
function library(initial: Row[], live: string | null) {
  let versions = initial;
  let current = live;
  const content = (v: string) => SKILL_MD('roll-dice', `# Version ${v}\n`);
  return fakeHarness((req: Recorded) => {
    if (req.method === 'GET' && req.path === '/skill-library/roll-dice') {
      return {
        body: {
          name: 'roll-dice',
          live_version: current,
          created_by: 'ops',
          created_at: 1,
          updated_at: 2,
          shadows_operator_upload: false,
          versions,
        },
      };
    }
    if (req.method === 'GET' && req.path.startsWith('/skill-library/-/review')) {
      return {
        body: {
          items: versions
            .filter((v) => v.status === 'draft')
            .map((v) => ({ ...v, live_version: current })),
          next_cursor: null,
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
          files: [{ path: 'SKILL.md', sha256: `sha-${detail[1]}`, size: 1 }],
          shadows_operator_upload: false,
        },
      };
    }
    const file = /^\/skill-library\/roll-dice\/versions\/(\d+\.\d+\.\d+)\/files\/SKILL\.md$/.exec(
      req.path,
    );
    if (req.method === 'GET' && file) return { body: fileBody('SKILL.md', content(file[1] ?? '')) };
    const move = /^\/skill-library\/roll-dice\/versions\/(.+)\/(publish|rollback|reject)$/.exec(
      req.path,
    );
    if (req.method === 'POST' && move) {
      const [, v, verb] = move;
      versions = versions.map((row) => {
        if (row.version === v) {
          return verb === 'reject'
            ? { ...row, status: 'archived', decided_at: 5, decided_by: 'ops' }
            : { ...row, status: 'published', published_at: 6 };
        }
        return row.status === 'published' && verb !== 'reject'
          ? { ...row, status: 'archived' }
          : row;
      });
      if (verb !== 'reject') current = v ?? null;
      return { body: versionRow({ version: v }) };
    }
    if (req.method === 'DELETE' && req.path === '/skill-library/roll-dice') {
      current = null;
      return { body: { name: 'roll-dice', live_version: null } };
    }
    return undefined;
  });
}

const THREE = () => [
  versionRow({ version: '0.1.2', parent_version: '0.1.1' }),
  versionRow({ version: '0.1.1', status: 'published', published_at: 2 }),
  versionRow({ version: '0.1.0', status: 'archived', published_at: 1 }),
];

const VERSIONS_AT = '/harness/skills?skill=roll-dice&tab=versions';

describe('version decisions', () => {
  it('rejects a draft with the note typed, and says it was rejected', async () => {
    const h = library(THREE(), '0.1.1');
    mountWithProviders(<SkillLibraryPage />, VERSIONS_AT);
    const list = await screen.findByRole('list', { name: 'Versions of roll-dice' });
    fireEvent.click(within(list).getByRole('button', { name: 'Reject…' }));
    fireEvent.change(within(list).getByLabelText(/Why reject 0\.1\.2/), {
      target: { value: 'Drops the steps' },
    });
    fireEvent.click(within(list).getByRole('button', { name: 'Reject 0.1.2' }));
    fireEvent.click(within(list).getByRole('button', { name: 'Reject 0.1.2' }));
    await waitFor(() =>
      expect(
        h.requests.find((r) => r.path === '/skill-library/roll-dice/versions/0.1.2/reject')?.body,
      ).toEqual({ note: 'Drops the steps' }),
    );
    expect(await within(list).findByText('rejected')).toBeTruthy();
  });

  it('will not reject on a blank note', async () => {
    library(THREE(), '0.1.1');
    mountWithProviders(<SkillLibraryPage />, VERSIONS_AT);
    const list = await screen.findByRole('list', { name: 'Versions of roll-dice' });
    fireEvent.click(within(list).getByRole('button', { name: 'Reject…' }));
    expect(
      (within(list).getByRole('button', { name: 'Reject 0.1.2' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('rolls back to a once-live version, naming the one it replaces', async () => {
    const h = library(THREE(), '0.1.1');
    mountWithProviders(<SkillLibraryPage />, VERSIONS_AT);
    fireEvent.click(await screen.findByRole('button', { name: 'Roll back to this' }));
    expect(await screen.findByText('0.1.0 goes live again, replacing 0.1.1.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Roll back to 0.1.0' }));
    await waitFor(() =>
      expect(
        h.requests.find(
          (r) =>
            r.method === 'POST' && r.path === '/skill-library/roll-dice/versions/0.1.0/rollback',
        )?.body,
      ).toEqual({ expected_live_version: '0.1.1' }),
    );
    await waitFor(() => expect(document.body.textContent).toContain('live 0.1.0'));
  });

  it('archives the skill with DELETE, after confirming', async () => {
    const h = library(THREE(), '0.1.1');
    mountWithProviders(<SkillLibraryPage />, VERSIONS_AT);
    fireEvent.click(await screen.findByRole('button', { name: 'Archive skill' }));
    expect(h.requests.some((r) => r.method === 'DELETE')).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Archive roll-dice' }));
    await waitFor(() =>
      expect(
        h.requests.some((r) => r.method === 'DELETE' && r.path === '/skill-library/roll-dice'),
      ).toBe(true),
    );
  });

  it('shows a not-found page for a skill the library does not hold, or cannot', async () => {
    library([], null);
    const { unmount } = mountWithProviders(
      <SkillLibraryPage />,
      '/harness/skills?skill=..%2F..%2Faudit',
    );
    expect(await screen.findByText(/no skill called/)).toBeTruthy();
    unmount();
    mountWithProviders(<SkillLibraryPage />, '/harness/skills?skill=other-skill');
    expect(await screen.findByText(/no skill called/)).toBeTruthy();
    expect(document.body.textContent).toContain('other-skill');
  });
});

describe('the review queue', () => {
  it('drops a draft once it is approved', async () => {
    const h = library(
      [
        versionRow({ version: '0.1.1', parent_version: '0.1.0' }),
        versionRow({ version: '0.1.0', status: 'published' }),
      ],
      '0.1.0',
    );
    h.fn.mockClear();
    mountWithProviders(<SkillLibrary />, '/harness/skills');
    const queue = await screen.findByRole('list', { name: 'Drafts waiting for review' });
    fireEvent.click(within(queue).getByRole('button', { name: 'Publish 0.1.1' }));
    await within(queue).findByText(/goes live, replacing live 0\.1\.0/);
    fireEvent.click(within(queue).getByRole('button', { name: 'Publish 0.1.1' }));
    await waitFor(() =>
      expect(h.requests.find((r) => r.path.endsWith('/0.1.1/publish'))?.body).toEqual({
        expected_live_version: '0.1.0',
      }),
    );
    expect(await screen.findByText('Nothing is waiting for review.')).toBeTruthy();
    expect(screen.queryByRole('list', { name: 'Drafts waiting for review' })).toBeNull();
  });
});

describe('the unsaved-changes guard', () => {
  function mountOnDataRouter() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router = createMemoryRouter(
      [
        {
          path: '/harness/skills',
          element: (
            <QueryClientProvider client={client}>
              <TooltipProvider>
                <SkillLibraryPage />
              </TooltipProvider>
            </QueryClientProvider>
          ),
        },
      ],
      { initialEntries: ['/harness/skills?skill=roll-dice&tab=edit'] },
    );
    render(<RouterProvider router={router} />);
    return router;
  }

  async function editThenLeave() {
    const source = (await screen.findByLabelText('SKILL.md source')) as HTMLTextAreaElement;
    await waitFor(() => expect(source.value).toContain('Version 0.1.1'));
    fireEvent.change(source, { target: { value: `${source.value}more\n` } });
    fireEvent.click(screen.getByRole('link', { name: 'Library' }));
    expect(await screen.findByText('Leave without saving?')).toBeTruthy();
    return source;
  }

  it('asks before leaving with edits, and Keep stays — edits and focus in the editor', async () => {
    library(THREE().slice(1), '0.1.1');
    const router = mountOnDataRouter();
    const source = await editThenLeave();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Keep editing' }));
    });
    await waitFor(() => expect(screen.queryByText('Leave without saving?')).toBeNull());
    expect(router.state.location.search).toContain('skill=roll-dice');
    const after = screen.getByLabelText('SKILL.md source') as HTMLTextAreaElement;
    expect(after.value).toContain('more');
    await waitFor(() => expect(document.activeElement).toBe(source));
  });

  it('Discard leaves', async () => {
    library(THREE().slice(1), '0.1.1');
    const router = mountOnDataRouter();
    await editThenLeave();
    fireEvent.click(screen.getByRole('button', { name: 'Discard and leave' }));
    await waitFor(() => expect(router.state.location.search).not.toContain('skill='));
  });

  it('does not ask on a tab switch with edits', async () => {
    library(THREE().slice(1), '0.1.1');
    const router = mountOnDataRouter();
    const source = (await screen.findByLabelText('SKILL.md source')) as HTMLTextAreaElement;
    await waitFor(() => expect(source.value).toContain('Version 0.1.1'));
    fireEvent.change(source, { target: { value: `${source.value}more\n` } });
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Versions' }));
    fireEvent.click(screen.getByRole('tab', { name: 'Versions' }));
    await waitFor(() => expect(router.state.location.search).toContain('tab=versions'));
    expect(screen.queryByText('Leave without saving?')).toBeNull();
  });
});
