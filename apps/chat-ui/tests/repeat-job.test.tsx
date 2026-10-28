// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { jobNameFor } from '../src/components/jobs/repeat-job-dialog';
import { ThemeProvider } from '../src/components/theme-provider';

/**
 * "Repeat on a schedule" on an operator's message: the Jobs page's form in a dialog,
 * prefilled, writing the same `PUT /jobs/{name}` the page writes — and saying before
 * anything is saved that the job runs on its own thread, not this one.
 */

describe('jobNameFor', () => {
  it('suggests the first words as a slug, never a trailing dash', () => {
    expect(jobNameFor('Summarize the open PRs, every morning!')).toBe(
      'summarize-the-open-prs-every',
    );
    expect(jobNameFor('  ')).toBe('');
    expect(jobNameFor('a'.repeat(60))).toHaveLength(40);
  });
});

const THREAD = 'repeat-job-thread';
const PROMPT = 'Summarize the open pull requests';
const snapshot = {
  id: `default:${THREAD}`,
  leafId: 'a1',
  transcript: [
    { id: 'u1', seq: 1, kind: 'message', role: 'user', content: PROMPT, metadata: {} },
    {
      id: 'a1',
      seq: 2,
      kind: 'message',
      role: 'assistant',
      content: 'Two are open.',
      metadata: { parent_id: 'u1' },
    },
  ],
};

const writes: { url: string; body: unknown }[] = [];

beforeEach(() => {
  writes.length = 0;
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: unknown, init?: RequestInit) => {
      const url = String(input);
      if (init?.method === 'PUT' && url.includes('/jobs/')) {
        const body = JSON.parse(String(init.body));
        writes.push({ url, body });
        return new Response(JSON.stringify({ name: 'x', ...body }), { status: 200 });
      }
      if (url.endsWith(`/chat/sessions/${THREAD}`))
        return new Response(JSON.stringify(snapshot), { status: 200 });
      if (url.includes('/chat/sessions'))
        return new Response(JSON.stringify({ sessions: [], items: [] }), { status: 200 });
      if (url.includes('/approvals'))
        return new Response(JSON.stringify({ requests: [] }), { status: 200 });
      if (url.includes('/jobs'))
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      return new Response('{}', { status: 200 });
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('repeating a message on a schedule', () => {
  it('opens the job form prefilled, says it is not this thread, and writes the job', async () => {
    render(
      <MemoryRouter initialEntries={[`/t/${THREAD}`]}>
        <ThemeProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    const user = userEvent.setup();
    const repeat = await screen.findByRole('button', {
      name: 'Repeat this message on a schedule',
    });
    // Offered on the operator's message alone: an answer is not a prompt.
    expect(
      screen.getAllByRole('button', { name: 'Repeat this message on a schedule' }),
    ).toHaveLength(1);
    await user.click(repeat);

    const dialog = await screen.findByRole('dialog', { name: 'Repeat on a schedule' });
    expect(dialog.textContent).toContain('not this one');
    expect((within(dialog).getByLabelText('Prompt') as HTMLTextAreaElement).value).toBe(PROMPT);
    expect((within(dialog).getByLabelText('Name') as HTMLInputElement).value).toBe(
      'summarize-the-open-pull-requests',
    );
    // An agent prompt only: the page's workflow switch is not offered here.
    expect(within(dialog).queryByText('Runs a workflow')).toBeNull();

    await user.click(within(dialog).getByRole('button', { name: 'Schedule' }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]?.url).toContain('/jobs/summarize-the-open-pull-requests');
    expect(writes[0]?.body).toMatchObject({
      schedule: '0 9 * * *',
      payload: { prompt: PROMPT },
      enabled: true,
    });
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Repeat on a schedule' })).toBeNull(),
    );
  });
});
