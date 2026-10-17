/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
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

async function sheet(
  jobs: unknown[] = [],
  opts: {
    runJobNow?: () => Promise<unknown>;
    runs?: unknown[];
    spend?: unknown;
    audit?: unknown[];
  } = {},
) {
  const upsertJob = vi.fn().mockResolvedValue(job());
  const runJobNow = vi.fn(opts.runJobNow ?? (() => Promise.resolve({})));
  vi.doMock('../src/api', () => ({
    listJobs: vi.fn().mockResolvedValue(jobs),
    listJobRuns: vi.fn().mockResolvedValue(opts.runs ?? []),
    upsertJob,
    runJobNow,
    deleteJob: vi.fn(),
    // `null` is a harness without `/usage/threads`: the rows say nothing about spend.
    listUsageByThread: vi.fn().mockResolvedValue(opts.spend ?? null),
    // The audit read the sidebar's Activity glance polls; a job's thread outcome rides it.
    listAudit: vi.fn().mockResolvedValue(opts.audit ?? []),
  }));
  const { JobsSheet } = await import('../src/components/jobs/jobs-sheet');
  render(
    <MemoryRouter>
      <JobsSheet manifest="quick" manifestOptions={['quick']} />
    </MemoryRouter>,
  );
  return { upsertJob, runJobNow };
}

/** The form is behind a disclosure now; open it the way an operator would. */
async function openForm() {
  fireEvent.click(await screen.findByRole('button', { name: /New job/ }));
  return waitFor(() => screen.getByLabelText('Name'));
}

describe('the page reads as a list first', () => {
  it('keeps the create form closed until asked, and counts jobs in the header', async () => {
    await sheet([job()]);
    await waitFor(() => expect(screen.getByText('1 job')).toBeTruthy());
    expect(screen.getByRole('heading', { name: 'Jobs' })).toBeTruthy();
    expect(screen.queryByLabelText(/Job name/)).toBeNull();
    const toggle = screen.getByRole('button', { name: /New job/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('Name')).toBeTruthy();
  });
});

describe('creating a job', () => {
  it('sends the prompt and fresh_thread only when they were set', async () => {
    const { upsertJob } = await sheet();
    const name = await openForm();
    fireEvent.change(name, { target: { value: 'triage' } });
    fireEvent.change(screen.getByLabelText('Prompt'), {
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
      // A new job is enabled unless the form says to start it paused.
      enabled: true,
    });
  });

  it('sends an empty payload for the default job, not an explicit false', async () => {
    // The scheduler reads `payload.get("fresh_thread")`; a stored `false` is a
    // key on every row that says nothing.
    const { upsertJob } = await sheet();
    const name = await openForm();
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

describe('a failed read after a good one', () => {
  it('keeps the jobs under one line, as every polled page does, not an error box', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const listJobs = vi
      .fn()
      .mockResolvedValueOnce([job({ name: 'digest' })])
      .mockRejectedValue(new Error('jobs : 500 {"error":"internal"}'));
    vi.doMock('../src/api', () => ({
      listJobs,
      listJobRuns: vi.fn().mockResolvedValue([]),
      upsertJob: vi.fn(),
      deleteJob: vi.fn(),
      listUsageByThread: vi.fn().mockResolvedValue(null),
      listAudit: vi.fn().mockResolvedValue([]),
    }));
    const { JobsSheet } = await import('../src/components/jobs/jobs-sheet');
    render(
      <MemoryRouter>
        <JobsSheet manifest="quick" manifestOptions={['quick']} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText('digest')).toBeTruthy());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4100);
    });
    await waitFor(() =>
      expect(screen.getByRole('alert').parentElement?.textContent).toMatch(/Showing what it said/),
    );
    expect(screen.getByText('digest')).toBeTruthy();
    vi.useRealTimers();
  });
});

describe('running a job now', () => {
  it('says it is running, then opens the history with what the agent answered', async () => {
    let finish: (run: unknown) => void = () => {};
    const run = {
      job_name: 'nightly-digest',
      run_id: 'r1',
      status: 'ok',
      error: '',
      started_at: Date.now(),
      finished_at: Date.now(),
      result: { status: 'ok', answer: 'Three PRs merged today.', trigger: 'manual' },
    };
    const { runJobNow } = await sheet([job()], {
      runJobNow: () => new Promise((r) => (finish = r)),
      runs: [run],
    });
    fireEvent.click(await screen.findByRole('button', { name: /^Run nightly-digest now$/ }));
    expect(runJobNow).toHaveBeenCalledWith('nightly-digest');
    // Named for its job, and counting while the turn runs.
    expect(await screen.findByText(/Running ·/)).toBeTruthy();

    await act(async () => finish(run));
    expect(await screen.findByText('Three PRs merged today.')).toBeTruthy();
    expect(screen.getByText('run by hand')).toBeTruthy();
    expect(screen.queryByText(/Running ·/)).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/^nightly-digest ran/);
  });

  it('says why when the harness refuses it', async () => {
    await sheet([job()], {
      runJobNow: () => Promise.reject(new Error('jobs /nightly-digest/run: 403 missing scope')),
    });
    fireEvent.click(await screen.findByRole('button', { name: /^Run nightly-digest now$/ }));
    expect(await screen.findByText(/not allowed to/)).toBeTruthy();
  });
});

/**
 * The harness runs an empty schedule every 60 seconds. The page called it "manual" and said
 * it never ran on its own, while a job so labelled fired about 1,440 times a day.
 */
describe('a schedule says what the harness will do', () => {
  it('labels an empty schedule by what it does, never "manual"', async () => {
    await sheet([job({ schedule: '' })]);
    await waitFor(() => expect(screen.getByText('every 1m')).toBeTruthy());
    expect(screen.queryByText('manual')).toBeNull();
  });

  it('says a job the scheduler has not claimed yet runs at the next sweep', async () => {
    await sheet([job({ next_run_at: null })]);
    await waitFor(() => expect(screen.getByText('first run at the next sweep')).toBeTruthy());
  });

  it('says a time already past is due, not "next just now"', async () => {
    await sheet([job({ next_run_at: Date.now() - 5_000 })]);
    await waitFor(() => expect(screen.getByText('due now')).toBeTruthy());
  });

  it('refuses a schedule the harness would refuse, before it is sent', async () => {
    const { upsertJob } = await sheet([]);
    await openForm();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'daily' } });
    fireEvent.change(screen.getByLabelText('Schedule'), { target: { value: '0 9 * *' } });
    expect((screen.getByRole('button', { name: 'Create' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.getByText(/Not a schedule/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Schedule'), { target: { value: '' } });
    expect(screen.getByText(/First run at the next sweep.*then every 1m/)).toBeTruthy();
    expect(upsertJob).not.toHaveBeenCalled();
  });

  it('puts the form away on Escape', async () => {
    await sheet([]);
    await openForm();
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByLabelText('Name')).toBeNull());
  });
});

describe('a job’s run history', () => {
  it('says when it was cut, and how long each run took', async () => {
    const runs = Array.from({ length: 20 }, (_, i) => ({
      run_id: `r${i}`,
      status: 'ok',
      started_at: 1_000_000 + i,
      finished_at: 1_000_000 + i + 4_200,
    }));
    await sheet([job()], { runs });
    fireEvent.click(await screen.findByRole('button', { name: 'Runs of nightly-digest' }));
    await waitFor(() => expect(screen.getByText('The latest 20 runs.')).toBeTruthy());
    expect(screen.getAllByText('4.2s')).toHaveLength(20);
  });
});

/**
 * `PUT /jobs/{name}` is an upsert. Create on an existing name replaced its schedule, agent and
 * prompt and turned a paused job back on, with nothing on screen to say so.
 */
describe('a name that already exists', () => {
  it('says what it replaces, relabels the button, and keeps the job paused', async () => {
    const { upsertJob } = await sheet([job({ name: 'digest', enabled: false })]);
    await openForm();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'digest' } });
    expect(
      screen.getByText(/exists\. Replace changes its schedule, agent and prompt/),
    ).toBeTruthy();
    expect(screen.getByText(/and it stays paused/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Replace' }));
    await waitFor(() => expect(upsertJob).toHaveBeenCalledTimes(1));
    expect(upsertJob.mock.calls[0][0].enabled).toBe(false);
  });
});

describe('pausing', () => {
  it('pauses and resumes a job by sending the same record with enabled flipped', async () => {
    const { upsertJob } = await sheet([job({ payload: { prompt: 'Digest.' } })]);
    fireEvent.click(await screen.findByRole('button', { name: 'Pause nightly-digest' }));
    await waitFor(() => expect(upsertJob).toHaveBeenCalledTimes(1));
    expect(upsertJob.mock.calls[0][0]).toEqual({
      name: 'nightly-digest',
      schedule: '0 9 * * *',
      manifest_id: 'quick',
      payload: { prompt: 'Digest.' },
      enabled: false,
    });
  });

  it('says a paused job is paused on its name line, and offers Resume', async () => {
    await sheet([job({ enabled: false })]);
    await waitFor(() => expect(screen.getByText('paused')).toBeTruthy());
    expect(screen.getByRole('button', { name: 'Resume nightly-digest' })).toBeTruthy();
  });

  it('can create a job paused, so it does not run at the next sweep', async () => {
    const { upsertJob } = await sheet([]);
    await openForm();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'staged' } });
    fireEvent.click(screen.getByLabelText('Start paused'));
    expect(screen.getByText(/^Starts paused/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(upsertJob).toHaveBeenCalledTimes(1));
    expect(upsertJob.mock.calls[0][0].enabled).toBe(false);
  });
});

describe('what a job costs', () => {
  it('sums the job’s threads over a day and links to its Activity entry', async () => {
    await sheet([job()], {
      spend: {
        since_ms: 0,
        until_ms: 1,
        truncated: false,
        totals: {},
        items: [
          { thread_id: 'default:job:nightly-digest', calls: 3, cost_usd: 0.12 },
          { thread_id: 'default:job:nightly-digest-2', calls: 9, cost_usd: 9 },
        ],
      },
    });
    const link = await screen.findByRole('link', { name: /\$0\.120 · 3 calls · 24h/ });
    expect(link.getAttribute('href')).toBe('/harness/activity?since=24h&thread=nightly-digest');
  });

  it('says nothing about cost on a harness without per-thread spend', async () => {
    await sheet([job()]);
    await waitFor(() => expect(screen.getByText('nightly-digest')).toBeTruthy());
    expect(screen.queryByText(/· 24h/)).toBeNull();
  });
});

/**
 * The scheduler's `last_status` says the firing returned. A job whose turn ended
 * on a broken call read `last ● OK` beside a thread the Activity page led with as
 * failed. The thread's newest turn, from the audit read the sidebar already
 * polls, now says what the run did — and only for the run the row is about.
 */
describe('how the last run went on its thread', () => {
  const ranAt = Date.now() - 10 * 60_000;
  const turn = (status: string, at = ranAt) => [
    {
      id: `u${at}`,
      event_type: 'user_input',
      status: 'ok',
      ts: (at + 1_000) / 1000,
      payload: { thread_id: 'default:job:nightly-digest' },
    },
    {
      id: `c${at}`,
      event_type: 'tool_call',
      status,
      ts: (at + 5_000) / 1000,
      payload: { thread_id: 'default:job:nightly-digest', tool: 'run' },
    },
  ];

  it('says the last run failed when its turn did, and links to its failures', async () => {
    await sheet([job({ last_status: 'ok', last_run_at: ranAt })], { audit: turn('error') });
    const outcome = await waitFor(() => {
      const el = document.querySelector('[data-slot="job-thread-outcome"]');
      expect(el).not.toBeNull();
      return el as HTMLElement;
    });
    expect(outcome.textContent).toContain('Failed');
    expect(screen.queryByText('OK')).toBeNull();
    const link = document.querySelector('[data-slot="job-thread-failures"]') as HTMLAnchorElement;
    expect(link.textContent).toBe('1 failed · 7d');
    expect(link.getAttribute('href')).toBe(
      '/harness/activity?since=7d&failed=1&thread=nightly-digest',
    );
  });

  it('keeps the scheduler’s word when the turn went fine, or belongs to an older run', async () => {
    await sheet(
      [
        job({ last_status: 'ok', last_run_at: ranAt }),
        // Its newest audited turn is a day older than its last firing: unknown.
        job({ name: 'weekly', last_status: 'ok', last_run_at: ranAt }),
      ],
      {
        audit: [
          ...turn('ok'),
          ...turn('error', ranAt - 86_400_000).map((e) => ({
            ...e,
            id: `w${e.id}`,
            payload: { ...e.payload, thread_id: 'default:job:weekly' },
          })),
        ],
      },
    );
    await waitFor(() => expect(screen.getAllByText('OK')).toHaveLength(2));
    expect(document.querySelector('[data-slot="job-thread-outcome"]')).toBeNull();
    // But the week behind it is said: `weekly` failed a day ago and its `last ● OK`
    // alone hid that, which is the row the Activity page was leading with.
    const failures = [...document.querySelectorAll('[data-slot="job-thread-failures"]')];
    expect(failures.map((a) => [a.textContent, a.getAttribute('href')])).toEqual([
      ['1 failed · 7d', '/harness/activity?since=7d&failed=1&thread=weekly'],
    ]);
  });
});

describe('schedules the operator should notice', () => {
  it('marks a stored schedule the scheduler refuses, and gives it no next time', async () => {
    await sheet([job({ schedule: '0 9 * *', next_run_at: Date.now() - 60_000 })]);
    await waitFor(() => expect(screen.getByText('invalid schedule')).toBeTruthy());
    expect(screen.queryByText('due now')).toBeNull();
  });

  it('says what an every-minute schedule costs in turns, before it is created', async () => {
    await sheet([]);
    await openForm();
    fireEvent.change(screen.getByLabelText('Schedule'), { target: { value: '' } });
    expect(screen.getByText(/every 1m — about 1,440 agent turns a day/)).toBeTruthy();
  });

  it('hands focus back to New job when the form is put away', async () => {
    await sheet([]);
    await openForm();
    fireEvent.keyDown(screen.getByLabelText('Name'), { key: 'Escape' });
    await waitFor(() =>
      expect(document.activeElement?.getAttribute('aria-controls')).toBe('job-create'),
    );
  });
});

describe('a job waiting on a person', () => {
  it('says so when an approval row names the job’s thread, as the client spells it', async () => {
    vi.doMock('../src/shell-context', () => ({
      useOptionalShell: () => ({
        tenantApprovals: {
          pending: [{ id: 'a1', tool: 'write_file', thread_id: 'nightly-digest' }],
        },
      }),
    }));
    await sheet([job()]);
    await waitFor(() =>
      expect(screen.getByText(/Waiting on an approval — see the attention line/)).toBeTruthy(),
    );
  });
});
