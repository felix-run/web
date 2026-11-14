// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkillLibrary } from '../src/components/skills/skill-library';
import { fakeHarness, mountWithProviders, type Recorded } from './skill-fixtures';

/**
 * The team library page's order: what waits on a person leads only when something does, the
 * list comes next, and the occasional business — imports, other people's libraries, the
 * publish policy — sits behind one Manage disclosure, closed until asked for.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const empty = { body: { items: [], next_cursor: null } };

function harness(over: (req: Recorded) => { status?: number; body: unknown } | undefined) {
  return fakeHarness((req) => {
    const answer = over(req);
    if (answer) return answer;
    if (req.path.startsWith('/skill-library/-/review')) return empty;
    if (req.path.startsWith('/skill-library/-/feedback')) return empty;
    if (req.path.startsWith('/skill-library?')) return empty;
    return undefined;
  });
}

const headings = () => screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);

describe('the team library page', () => {
  it('says an empty queue and inbox in one quiet line, not two sections', async () => {
    harness(() => undefined);
    mountWithProviders(<SkillLibrary />, '/harness/skills');
    expect(await screen.findByText('No drafts or feedback waiting')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Waiting for review' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Feedback waiting for a decision' })).toBeNull();
    expect(screen.queryByText('Nothing is waiting for review.')).toBeNull();
    expect(screen.queryByText('No feedback is waiting for a decision.')).toBeNull();
  });

  it('puts a waiting draft above the library', async () => {
    harness((req) =>
      req.path.startsWith('/skill-library/-/review')
        ? {
            body: {
              items: [
                {
                  name: 'roll-dice',
                  version: '0.1.1',
                  live_version: null,
                  parent_version: null,
                  source: 'agent',
                  author: 'cowork',
                  reason: null,
                  quality_score: null,
                  security_status: null,
                  created_at: Date.now(),
                },
              ],
              next_cursor: null,
            },
          }
        : undefined,
    );
    mountWithProviders(<SkillLibrary />, '/harness/skills');
    await screen.findByRole('heading', { name: 'Waiting for review' });
    const order = headings();
    expect(order.indexOf('Waiting for review')).toBeLessThan(order.indexOf('Library'));
    // The inbox is empty, so it is the quiet line rather than a section.
    expect(screen.getByText('No feedback waiting')).toBeTruthy();
  });

  it('keeps a section whose read failed, rather than calling it empty', async () => {
    harness((req) =>
      req.path.startsWith('/skill-library/-/feedback')
        ? { status: 403, body: { error: 'missing_scope', message: 'no' } }
        : undefined,
    );
    mountWithProviders(<SkillLibrary />, '/harness/skills');
    expect(
      await screen.findByRole('heading', { name: 'Feedback waiting for a decision' }),
    ).toBeTruthy();
    expect(await screen.findByText('No drafts waiting')).toBeTruthy();
    expect(screen.queryByText('No drafts or feedback waiting')).toBeNull();
  });

  it('holds import, personal libraries and the policy behind Manage, remembered for the tab', async () => {
    const h = harness(() => undefined);
    const { unmount } = mountWithProviders(<SkillLibrary />, '/harness/skills');
    const manage = await screen.findByRole('button', { name: 'Manage' });
    expect(manage.getAttribute('aria-expanded')).toBe('false');
    for (const name of ['Import from GitHub', 'Personal libraries', 'Publish policy']) {
      expect(screen.queryByRole('heading', { name })).toBeNull();
    }
    // Closed, the policy is not read for its form.
    expect(h.requests.some((r) => r.path === '/skill-library/-/policy')).toBe(false);
    fireEvent.click(manage);
    expect(manage.getAttribute('aria-expanded')).toBe('true');
    for (const name of ['Import from GitHub', 'Personal libraries', 'Publish policy']) {
      expect(screen.getByRole('heading', { name })).toBeTruthy();
    }
    // Opening never lists the personal libraries: that waits for Show.
    expect(h.requests.some((r) => r.path === '/skill-library/-/personal')).toBe(false);
    unmount();

    mountWithProviders(<SkillLibrary />, '/harness/skills');
    const again = await screen.findByRole('button', { name: 'Manage' });
    expect(again.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(again);
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Publish policy' })).toBeNull(),
    );
  });

  it('opens Manage for a link that names one of its sections', async () => {
    harness(() => undefined);
    mountWithProviders(<SkillLibrary />, '/harness/skills?manage=import');
    expect(await screen.findByRole('heading', { name: 'Import from GitHub' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Manage' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });
});
