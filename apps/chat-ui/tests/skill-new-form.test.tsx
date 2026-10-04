// @vitest-environment happy-dom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SkillLibrary } from '../src/components/skills/skill-library';
import { fakeHarness, mountWithProviders } from './skill-fixtures';

/**
 * The New skill form. Create used to be disabled until both fields were
 * valid, and an empty description had no message of its own — so the button
 * sat greyed out with nothing on screen to say why. It stays pressable now,
 * and pressing it on an incomplete form names what is missing, moves focus
 * there, and sends nothing.
 */

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function harness() {
  return fakeHarness((req) => {
    if (req.method === 'POST' && req.path === '/skill-library') {
      return {
        status: 201,
        body: { name: 'release-notes', version: '0.1.0', status: 'draft', files: [] },
      };
    }
    if (req.path.startsWith('/skill-library')) return { body: { items: [], next_cursor: null } };
    return undefined;
  });
}

function openForm() {
  mountWithProviders(<SkillLibrary />, '/harness/skills');
  fireEvent.click(screen.getByRole('button', { name: 'New skill' }));
  return {
    name: screen.getByLabelText('Name') as HTMLInputElement,
    description: screen.getByLabelText(/^Description/) as HTMLTextAreaElement,
    create: screen.getByRole('button', { name: 'Create draft' }) as HTMLButtonElement,
  };
}

const posts = (h: ReturnType<typeof harness>) =>
  h.requests.filter((r) => r.method === 'POST' && r.path === '/skill-library');

describe('New skill form', () => {
  it('says the description is missing rather than sitting disabled', () => {
    const h = harness();
    const form = openForm();
    fireEvent.change(form.name, { target: { value: 'release-notes' } });
    expect(form.create.disabled).toBe(false);
    fireEvent.click(form.create);
    expect(screen.getByText(/A description is required/)).toBeTruthy();
    expect(form.description.getAttribute('aria-invalid')).toBe('true');
    expect(document.activeElement).toBe(form.description);
    expect(posts(h)).toHaveLength(0);
  });

  it('names the name first when both are missing', () => {
    harness();
    const form = openForm();
    fireEvent.click(form.create);
    expect(screen.getByText('A name is required.')).toBeTruthy();
    expect(document.activeElement).toBe(form.name);
  });

  it('creates the draft once both are filled', async () => {
    const h = harness();
    const form = openForm();
    fireEvent.change(form.name, { target: { value: 'release-notes' } });
    fireEvent.change(form.description, { target: { value: 'Drafts release notes.' } });
    fireEvent.click(form.create);
    await waitFor(() => expect(posts(h)).toHaveLength(1));
    const body = posts(h)[0]?.body as { files: Record<string, string> };
    expect(body.files['SKILL.md']).toContain('name: release-notes');
  });
});
