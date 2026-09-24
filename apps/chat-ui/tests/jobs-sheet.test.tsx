/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The two payload fields a job has and the form did not: the prompt each firing
 * sends, and `fresh_thread`, which gives each firing a thread of its own.
 *
 * Both live inside the job's free-form `payload`, which is why nothing mechanical
 * noticed they were missing — `check-payload-shapes` reads the row's keys and
 * `payload` is one key. What is pinned here is the wire: the form sends exactly
 * the keys that were set, and a stored job says which mode it runs in.
 */

afterEach(cleanup);
beforeEach(() => {
  vi.resetModules();
});

const job = (over: Record<string, unknown> = {}) => ({
  tenant_id: 'default',
  name: 'nightly-digest',
  schedule: '0 9 * * *',
  manifest_id: 'quick',
  enabled: true,
  last_status: '',
  last_error: '',
  created_at: 1,
  payload: {},
  ...over,
});

async function sheet(jobs: unknown[] = []) {
  const upsertJob = vi.fn().mockResolvedValue(job());
  vi.doMock('../src/api', () => ({
    listJobs: vi.fn().mockResolvedValue(jobs),
    listJobRuns: vi.fn().mockResolvedValue([]),
    upsertJob,
    deleteJob: vi.fn(),
  }));
  const { JobsSheet } = await import('../src/components/jobs/jobs-sheet');
  render(<JobsSheet manifest="quick" manifestOptions={['quick']} />);
  return { upsertJob };
}

describe('creating a job', () => {
  it('sends the prompt and fresh_thread only when they were set', async () => {
    const { upsertJob } = await sheet();
    const name = await waitFor(() => screen.getByLabelText(/Job name/));
    fireEvent.change(name, { target: { value: 'triage' } });
    fireEvent.change(screen.getByLabelText(/Prompt sent on each run/), {
      target: { value: 'Take the next ticket.' },
    });
    fireEvent.click(screen.getByLabelText(/Fresh thread each run/));
    fireEvent.click(screen.getByRole('button', { name: /Create/ }));

    await waitFor(() => expect(upsertJob).toHaveBeenCalledTimes(1));
    expect(upsertJob).toHaveBeenCalledWith({
      name: 'triage',
      schedule: '0 9 * * *',
      manifest_id: 'quick',
      payload: { prompt: 'Take the next ticket.', fresh_thread: true },
    });
  });

  it('sends an empty payload for the default job, not an explicit false', async () => {
    // The scheduler reads `payload.get("fresh_thread")`; a stored `false` is a
    // key on every row that says nothing.
    const { upsertJob } = await sheet();
    const name = await waitFor(() => screen.getByLabelText(/Job name/));
    fireEvent.change(name, { target: { value: 'digest' } });
    fireEvent.click(screen.getByRole('button', { name: /Create/ }));

    await waitFor(() => expect(upsertJob).toHaveBeenCalledTimes(1));
    expect(upsertJob.mock.calls[0][0].payload).toEqual({});
  });
});

describe('a stored job says how it runs', () => {
  it('names the fresh-thread mode and the prompt when the job has them', async () => {
    await sheet([
      job({ name: 'triage', payload: { prompt: 'Take the next ticket.', fresh_thread: true } }),
    ]);
    await waitFor(() => expect(screen.getByText('triage')).toBeTruthy());
    expect(screen.getByText(/fresh thread each run/)).toBeTruthy();
    expect(screen.getByText(/Take the next ticket\./)).toBeTruthy();
  });

  it('says nothing about the mode for a job on the default', async () => {
    // Restating the default on every row is what makes the exception vanish.
    await sheet([job()]);
    await waitFor(() => expect(screen.getByText('nightly-digest')).toBeTruthy());
    expect(screen.queryByText(/fresh thread each run/)).toBeNull();
  });
});
