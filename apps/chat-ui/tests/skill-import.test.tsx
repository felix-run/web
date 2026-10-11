// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { resetsAt } from '../src/components/skills/refusal';
import {
  AdoptButton,
  ImportSection,
  movedLine,
  SourceCheck,
  UpdatesSection,
} from '../src/components/skills/skill-import';
import { fakeHarness, mountWithProviders, versionRow } from './skill-fixtures';

/**
 * Skills from GitHub: browse a source, import one as a draft, see which imported skills'
 * sources moved, check one against its source and save the update as a draft, and adopt an
 * imported version with a reason. Every write is a draft; nothing here publishes.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const linkTo = (name: string, version?: string) =>
  `?skill=${name}${version ? `&v=${version}` : ''}`;

const listing = {
  source: 'github:acme/skills',
  ref: 'main',
  commit: 'abcdef1234567890',
  license: 'MIT',
  min_age_days: 7,
  found: 2,
  truncated: false,
  items: [
    {
      name: 'pdf',
      description: 'Reads PDFs.',
      path: 'pdf',
      source: 'github:acme/skills/pdf',
      first_seen_at: 1,
      eligible_at: 2,
      eligible: true,
    },
    {
      name: 'fresh',
      description: 'Just pushed.',
      path: 'fresh',
      source: 'github:acme/skills/fresh',
      first_seen_at: Date.now(),
      eligible_at: Date.now() + 7 * 86_400_000,
      eligible: false,
    },
  ],
};

describe('importing from GitHub', () => {
  it('browses a source, imports one as a draft, and says when another can be taken', async () => {
    const h = fakeHarness((req) => {
      if (req.path.startsWith('/skill-library/-/browse?')) return { body: listing };
      if (req.path === '/skill-library/-/import') {
        return {
          status: 201,
          body: {
            ...versionRow({ name: 'pdf', source: 'import' }),
            unchanged: false,
            dropped_files: ['tests/test_forms.py'],
            relocated_files: {
              'forms/w9.md': 'references/forms/w9.md',
              'forms/1099.md': 'references/forms/1099.md',
            },
          },
        };
      }
      return undefined;
    });
    mountWithProviders(<ImportSection linkTo={linkTo} />);
    fireEvent.change(screen.getByLabelText(/Source/), { target: { value: 'github:acme/skills' } });
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }));

    await waitFor(() =>
      expect(document.body.textContent).toContain('2 skills at main (abcdef1) · MIT'),
    );
    expect(screen.getByText(/Can be imported from/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Import as draft/ }));

    await waitFor(() =>
      expect(h.requests.find((r) => r.path === '/skill-library/-/import')?.body).toEqual({
        source: 'github:acme/skills/pdf',
      }),
    );
    expect((await screen.findByRole('link', { name: '0.1.0' })).getAttribute('href')).toContain(
      '?skill=pdf&v=0.1.0',
    );
    // What moved is said beside what was left out, so the draft's references/forms/ is explained.
    expect(document.body.textContent).toContain(
      'moved forms/ (2 files) under references/ · left out 1 file',
    );
  });

  it('says why a source could not be read, in the library’s words', async () => {
    fakeHarness((req) =>
      req.path.startsWith('/skill-library/-/browse?')
        ? { status: 404, body: { error: 'source_not_found', message: 'no such repo' } }
        : undefined,
    );
    mountWithProviders(<ImportSection linkTo={linkTo} />);
    fireEvent.change(screen.getByLabelText(/Source/), { target: { value: 'github:acme/nope' } });
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }));
    expect(await screen.findByText(/No such repository/)).toBeTruthy();
  });
});

describe('imported skills', () => {
  it('lists the moved ones first, and re-checks GitHub only when asked', async () => {
    const h = fakeHarness((req) =>
      req.path.startsWith('/skill-library/-/upstream')
        ? {
            body: {
              items: [
                {
                  name: 'same',
                  version: '0.1.0',
                  live_version: '0.1.0',
                  origin_source: 'github:a/b/same',
                  origin_ref: 'main',
                  origin_commit: 'x',
                  update_available: false,
                },
                {
                  name: 'moved',
                  version: '0.1.0',
                  live_version: '0.1.0',
                  origin_source: 'github:a/b/moved',
                  origin_ref: 'main',
                  origin_commit: 'y',
                  update_available: true,
                  eligible: true,
                },
              ],
              next_cursor: null,
              refreshed: false,
              min_age_days: 0,
              stopped: null,
            },
          }
        : undefined,
    );
    mountWithProviders(<UpdatesSection linkTo={linkTo} />);
    const rows = await screen.findAllByRole('listitem');
    expect(rows[0]?.textContent).toContain('moved');
    expect(screen.getByText(/1 with changes at the source/)).toBeTruthy();
    expect(h.requests.every((r) => !r.path.includes('refresh=true'))).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /Check now/ }));
    await waitFor(() => expect(h.requests.some((r) => r.path.includes('refresh=true'))).toBe(true));
  });

  it('is not drawn on a harness without the route', async () => {
    const h = fakeHarness(() => undefined);
    const { container } = mountWithProviders(<UpdatesSection linkTo={linkTo} />);
    await waitFor(() => expect(h.requests.length).toBeGreaterThan(0));
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe('');
  });

  it('checks one against its source on request, shows the diff, and saves the update as a draft', async () => {
    const h = fakeHarness((req) => {
      if (req.path === '/skill-library/pdf/-/upstream') {
        return {
          body: {
            name: 'pdf',
            current: {
              version: '0.1.0',
              status: 'published',
              source: 'github:a/b/pdf',
              ref: 'main',
              commit: 'x',
              tree_hash: 't',
              live_version: '0.1.0',
            },
            upstream: {
              source: 'github:a/b/pdf',
              ref: 'main',
              commit: 'abcdef9999',
              tree_hash: 'u',
              license: null,
              committed_at: null,
              first_seen_at: 1,
              eligible_at: 2,
              eligible: true,
            },
            update_available: true,
            min_age_days: 0,
            diff: {
              compared_with: '0.1.0',
              diff_truncated: false,
              files: [
                {
                  path: 'SKILL.md',
                  change: 'modified',
                  binary: false,
                  old_size: 10,
                  new_size: 12,
                  diff: '@@ -1 +1 @@\n-old line\n+new line',
                  truncated: false,
                },
              ],
            },
          },
        };
      }
      if (req.path === '/skill-library/pdf/-/update') {
        return {
          status: 201,
          body: {
            ...versionRow({ name: 'pdf', version: '0.2.0', source: 'import' }),
            unchanged: false,
            dropped_files: [],
            diff: { compared_with: '0.1.0', files: [], diff_truncated: false },
          },
        };
      }
      return undefined;
    });
    mountWithProviders(<SourceCheck name="pdf" linkTo={linkTo} />);
    // Nothing is asked of GitHub until the operator asks.
    expect(h.requests).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: /Check the source/ }));
    expect(await screen.findByText('+new line')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /Save the source’s version as a draft/ }));
    expect(await screen.findByRole('link', { name: '0.2.0' })).toBeTruthy();
    expect(h.requests.find((r) => r.path === '/skill-library/pdf/-/update')?.method).toBe('POST');
  });
});

describe('adopting an imported version', () => {
  it('needs a reason, and sends it', async () => {
    const h = fakeHarness((req) =>
      req.path.endsWith('/adopt')
        ? {
            status: 201,
            body: {
              ...versionRow({ name: 'pdf', version: '0.2.0', source: 'operator' }),
              published: false,
              publish_blocked: null,
              review_checks: [],
              security_issues: [],
              files: [],
              shadows_operator_upload: false,
            },
          }
        : undefined,
    );
    mountWithProviders(
      <AdoptButton
        version={
          versionRow({
            name: 'pdf',
            version: '0.1.0',
            source: 'import',
            lineage_import: true,
          }) as never
        }
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Adopt…/ }));
    const submit = screen.getByRole('button', { name: 'Adopt 0.1.0' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Why you vouch/), {
      target: { value: 'read every line' },
    });
    fireEvent.click(submit);
    await waitFor(() =>
      expect(
        h.requests.find((r) => r.path === '/skill-library/pdf/versions/0.1.0/adopt')?.body,
      ).toEqual({
        reason: 'read every line',
      }),
    );
    expect(await screen.findByText(/Adopted as draft/)).toBeTruthy();
  });
});

describe('movedLine', () => {
  it('names one or two folders, counts past that, and says nothing for no moves', () => {
    expect(movedLine(undefined)).toBe('');
    expect(movedLine({})).toBe('');
    expect(movedLine({ 'reference.md': 'references/reference.md' })).toBe(
      ' · moved reference.md (1 file) under references/',
    );
    expect(movedLine({ 'a/x.md': 'references/a/x.md', 'b/y.md': 'references/b/y.md' })).toBe(
      ' · moved a/ and b/ (2 files) under references/',
    );
    expect(
      movedLine({
        'a/x.md': 'references/a/x.md',
        'b/y.md': 'references/b/y.md',
        'c/z.md': 'references/c/z.md',
      }),
    ).toBe(' · moved 3 files under references/');
    expect(
      movedLine({ 'showcase.pdf': 'assets/showcase.pdf', 'themes/a.md': 'references/themes/a.md' }),
    ).toBe(' · moved showcase.pdf and themes/ (2 files) under references/ and assets/');
  });
});

describe('a GitHub rate limit', () => {
  it('says when the limit lifts, rather than a raw epoch and "a few minutes"', async () => {
    const reset = Math.floor(Date.now() / 1000) + 57 * 60;
    fakeHarness((req) =>
      req.path.startsWith('/skill-library/-/browse?')
        ? {
            status: 502,
            body: {
              error: 'upstream_rate_limited',
              message: `GitHub's rate limit is exhausted (resets at ${reset}); FELIX_SKILL_IMPORT_GITHUB_TOKEN raises it`,
            },
          }
        : undefined,
    );
    mountWithProviders(<ImportSection linkTo={linkTo} />);
    fireEvent.change(screen.getByLabelText(/Source/), { target: { value: 'github:acme/skills' } });
    fireEvent.click(screen.getByRole('button', { name: 'Browse' }));

    const time = new Date(reset * 1000).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
    });
    expect(
      await screen.findByText(`GitHub is rate-limiting the harness until ${time} (in 57 minutes).`),
    ).toBeTruthy();
    expect(screen.queryByText(/a few minutes/)).toBeNull();
    expect(
      screen.getByText(new RegExp(`resets at ${time.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`)),
    ).toBeTruthy();
  });

  it('reads no reset from a message that names none', () => {
    expect(resetsAt('GitHub said no')).toBeNull();
    expect(resetsAt('resets at 1791760021', 1791760021 * 1000 - 30_000)?.in).toBe(
      'about a minute from now',
    );
  });
});
