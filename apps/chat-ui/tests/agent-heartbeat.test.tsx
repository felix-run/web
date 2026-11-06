/** @vitest-environment happy-dom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A person's heartbeat on the Agent page. What is pinned is what the harness cannot say for the
 * page: an agent that offers nothing draws nothing, even when the read was refused; a heartbeat
 * that outlived its offer can still be turned off; turning it off is not removing it; and a run
 * says what it did, in words, without calling a skip a failure or an outage an all-clear. The run
 * shapes are the harness's own: `felix/jobs/heartbeat.py` and `felix/jobs/preferences.py`.
 */

afterEach(cleanup);
beforeEach(() => {
  vi.resetModules();
});

const row = (over: Record<string, unknown> = {}) => ({
  manifest: 'concierge',
  name: 'hb-concierge-abc',
  enabled: true,
  schedule: '0 9 * * *',
  timezone: 'America/Phoenix',
  thread_id: 'default:hb-1234',
  next_run_at: Date.now() + 3_600_000,
  last_run_at: Date.now() - 7_200_000,
  last_status: 'ok',
  expires_at: null,
  ...over,
});

/** Every read a new array, as the harness answers: the page tells reads apart by identity. */
const reads = (rows: unknown[]) => vi.fn(async () => [...rows]);

const offer = { schedule: '0 9 * * *', timezone: 'America/Phoenix' };

async function mount(
  api: Record<string, unknown> = {},
  props: { agent?: string; offer?: typeof offer } = { offer },
) {
  const mocks = {
    listHeartbeats: reads([]),
    setHeartbeat: vi.fn(async (_agent: string, enabled: boolean) => row({ enabled })),
    deleteHeartbeat: vi.fn().mockResolvedValue(undefined),
    runHeartbeat: vi.fn().mockResolvedValue({ status: 'ok', result: {} }),
    ...api,
  };
  vi.doMock('@/api', () => mocks);
  const { AgentHeartbeat } = await import('../src/components/harness/agent-heartbeat');
  const view = render(
    <MemoryRouter>
      <AgentHeartbeat agent={props.agent ?? 'concierge'} offer={props.offer} />
    </MemoryRouter>,
  );
  return { mocks, view };
}

describe('AgentHeartbeat', () => {
  it('says what turning it on agrees to, zone included', async () => {
    const { mocks } = await mount();
    const consent = await screen.findByText(/can check in for you/);
    expect(consent.textContent).toMatch(/0 9 \* \* \* · America\/Phoenix/);
    expect(consent.textContent).toMatch(/Until you turn it off/);
    expect(consent.textContent).toMatch(/as you and with your access/);
    expect(consent.textContent).toMatch(/can act with any tool that needs no approval/);
    expect(consent.textContent).toMatch(/operator decides what it checks and can change that/);
    expect(consent.textContent).toMatch(/others with access to jobs or conversations here/);
    fireEvent.click(screen.getByRole('button', { name: 'Turn on' }));
    await waitFor(() => expect(mocks.setHeartbeat).toHaveBeenCalledWith('concierge', true));
    await screen.findByText(/first runs at its next scheduled time/);
    expect(mocks.listHeartbeats.mock.calls.length).toBeGreaterThan(1);
  });

  it('reads a clock schedule with no zone as UTC', async () => {
    await mount({}, { offer: { schedule: '0 9 * * *' } as typeof offer });
    await screen.findByText(/0 9 \* \* \* · UTC/);
  });

  it('gives an interval schedule no zone', async () => {
    await mount({}, { offer: { schedule: 'every:60m', timezone: 'America/Phoenix' } });
    const consent = await screen.findByText(/can check in for you/);
    expect(consent.textContent).toMatch(/\(every 1h\)/);
  });

  it('does not ask before it knows the person has none', async () => {
    await mount({ listHeartbeats: vi.fn(() => new Promise(() => {})) });
    await act(async () => {});
    expect(screen.queryByText(/can check in for you/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Turn on' })).toBeNull();
  });

  it('draws nothing for an agent that offers none, even when the read is refused', async () => {
    const { view, mocks } = await mount(
      { listHeartbeats: vi.fn().mockRejectedValue(new Error('heartbeats: 403 {"detail":"no"}')) },
      {},
    );
    await waitFor(() => expect(mocks.listHeartbeats).toHaveBeenCalled());
    await act(async () => {});
    expect(view.container.textContent).toBe('');
  });

  it.each([
    'shared_subject',
    'no_caller',
  ])('says %s once, quietly: no alert and no retry, since none would help', async (code) => {
    await mount({
      listHeartbeats: vi
        .fn()
        .mockRejectedValue(
          new Error(`heartbeats: 403 {"detail":{"error":"${code}","detail":"x"}}`),
        ),
    });
    await screen.findByText(/belongs to one signed-in person/);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('still reports any other failed read when the agent offers one', async () => {
    await mount({
      listHeartbeats: vi.fn().mockRejectedValue(new Error('heartbeats: 403 {"detail":"no"}')),
    });
    await screen.findByRole('alert');
  });

  it('keeps a heartbeat that outlived its offer, so it can still be turned off', async () => {
    const { mocks } = await mount({ listHeartbeats: reads([row()]) }, {});
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(mocks.setHeartbeat).toHaveBeenCalledWith('concierge', false));
    expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy();
  });

  it('says plainly when turning back on is refused, and rereads', async () => {
    const { mocks } = await mount(
      {
        listHeartbeats: reads([row({ enabled: false })]),
        setHeartbeat: vi
          .fn()
          .mockRejectedValue(new Error('heartbeats/set: 422 {"detail":{"error":"no_heartbeat"}}')),
      },
      {},
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    await screen.findByText(/no longer defines a heartbeat/);
    expect(mocks.listHeartbeats.mock.calls.length).toBeGreaterThan(1);
    expect(screen.getByRole('button', { name: 'Remove' }).hasAttribute('disabled')).toBe(false);
  });

  it("ignores the person's heartbeat on another agent", async () => {
    await mount({ listHeartbeats: reads([row({ manifest: 'inbox' })]) });
    await screen.findByRole('button', { name: 'Turn on' });
    expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull();
  });

  it('links its conversation by suffix and its job by name', async () => {
    await mount({ listHeartbeats: reads([row()]) });
    const conversation = await screen.findByRole('link', { name: 'Its conversation' });
    expect(conversation.getAttribute('href')).toBe('/t/hb-1234');
    expect(screen.getByRole('link', { name: 'Runs and preferences' }).getAttribute('href')).toBe(
      '/harness/jobs?job=hb-concierge-abc',
    );
  });

  it('turns off with a PUT, keeping it, and removes only with a DELETE', async () => {
    const { mocks } = await mount({ listHeartbeats: reads([row()]) });
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(mocks.setHeartbeat).toHaveBeenCalledWith('concierge', false));
    expect(mocks.deleteHeartbeat).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    expect(mocks.deleteHeartbeat).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove heartbeat' }));
    await waitFor(() => expect(mocks.deleteHeartbeat).toHaveBeenCalledWith('concierge'));
  });

  it('takes Run now away with the Turn off, before any read confirms it', async () => {
    await mount({
      listHeartbeats: vi
        .fn()
        .mockResolvedValueOnce([row()])
        .mockReturnValue(new Promise(() => {})),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
    await screen.findByText(/Your heartbeat is off/);
    expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Turn on' })).toBeTruthy();
  });

  it('keeps a Turn off when a read lands while it is being written', async () => {
    let finish: (value: unknown) => void = () => {};
    const { mocks } = await mount({
      listHeartbeats: vi
        .fn()
        .mockResolvedValueOnce([row()])
        .mockResolvedValueOnce([row()])
        .mockReturnValue(new Promise(() => {})),
      setHeartbeat: vi.fn(() => new Promise((resolve) => (finish = resolve))),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
    await waitFor(() => expect(mocks.setHeartbeat).toHaveBeenCalled());
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(mocks.listHeartbeats).toHaveBeenCalledTimes(2));
    await act(async () => {
      finish(row({ enabled: false }));
    });
    await screen.findByText(/Your heartbeat is off/);
    expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull();
  });

  it('shows what a read says once one arrives, not what the write said', async () => {
    await mount({
      listHeartbeats: vi
        .fn()
        .mockResolvedValueOnce([row()])
        .mockResolvedValue([row({ enabled: true })]),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Turn off' }));
    await screen.findByText(/Your heartbeat is off/);
    await screen.findByRole('button', { name: 'Run now' });
  });

  it('shows the next run the write answered, before any read does', async () => {
    const due = Date.UTC(2031, 0, 2, 16);
    await mount({
      listHeartbeats: vi
        .fn()
        .mockResolvedValueOnce([])
        .mockReturnValue(new Promise(() => {})),
      setHeartbeat: vi.fn().mockResolvedValue(row({ next_run_at: due })),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Turn on' }));
    await screen.findByText(new Date(due).toLocaleString());
    expect(screen.queryByText(/can check in for you/)).toBeNull();
  });

  it('goes back to the offer the moment it is removed', async () => {
    await mount({
      listHeartbeats: vi
        .fn()
        .mockResolvedValueOnce([row()])
        .mockReturnValue(new Promise(() => {})),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove heartbeat' }));
    await screen.findByText(/Your heartbeat is removed/);
    await screen.findByText(/can check in for you/);
    expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull();
  });

  it('says it was removed even with no offer to go back to, and offers nothing', async () => {
    await mount(
      { listHeartbeats: vi.fn().mockResolvedValueOnce([row()]).mockResolvedValue([]) },
      {},
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove heartbeat' }));
    await screen.findByText(/Your heartbeat is removed/);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('holds the buttons while a run is going, so it cannot be asked for twice', async () => {
    const { mocks } = await mount({
      listHeartbeats: reads([row()]),
      runHeartbeat: vi.fn(() => new Promise(() => {})),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }));
    const running = await screen.findByRole('button', { name: 'Running…' });
    fireEvent.click(running);
    expect(mocks.runHeartbeat).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Turn off' }).hasAttribute('disabled')).toBe(true);
  });

  it('marks a failed last run', async () => {
    await mount({ listHeartbeats: reads([row({ last_status: 'error' })]) });
    expect((await screen.findByText(/· error/)).className).toContain('text-state-failed');
  });

  it('does not mark a skipped one', async () => {
    await mount({ listHeartbeats: reads([row({ last_status: 'skipped' })]) });
    expect((await screen.findByText(/· skipped/)).className).not.toContain('text-state-failed');
  });

  it('says a new heartbeat has not run yet', async () => {
    await mount({ listHeartbeats: reads([row({ last_run_at: null, last_status: null })]) });
    await screen.findByText('not yet');
  });

  it('offers Turn on and no Run now while it is off', async () => {
    await mount({ listHeartbeats: reads([row({ enabled: false })]) });
    await screen.findByRole('button', { name: 'Turn on' });
    expect(screen.getByText('off')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Run now' })).toBeNull();
    expect(screen.queryByText('Next run')).toBeNull();
  });

  it.each([
    [
      { status: 'ok', result: { status: 'ok', quiet: true, answer: 'HEARTBEAT_OK' } },
      /found nothing to tell you/,
    ],
    [
      { status: 'ok', result: { quiet: true, answer: 'I could not check the build.' } },
      /sent no notice\. It said: I could not check the build\./,
    ],
    [
      { status: 'ok', result: { quiet: true, answer: 'HEARTBEAT_OK, but I could not check mail' } },
      /sent no notice\. It said: HEARTBEAT_OK, but/,
    ],
    [{ status: 'ok', result: { quiet: true, answer: '' } }, /ran and sent no notice\.$/],
    [
      { status: 'ok', result: { quiet: false, answer: 'Told them.' } },
      /Anything it found is in its conversation/,
    ],
    [
      { status: 'error', error: 'provider returned HTTP 401' },
      /failed: provider returned HTTP 401/,
    ],
    [{ status: 'error', error: '' }, /Your heartbeat failed\./],
    [
      {
        status: 'error',
        error: 'this manifest no longer defines a heartbeat; it has been turned off',
      },
      /failed: this manifest no longer defines a heartbeat; it has been turned off/,
    ],
    [
      {
        status: 'error',
        error: 'the run failed',
        result: { unavailable_sources: { concierge: ['tracker'] } },
      },
      /failed: the run failed\. It could not reach tracker\./,
    ],
    [
      { status: 'skipped', result: { reason: 'daily_cap', max_firings_per_day: 4 } },
      /reached today's limit of 4, counted in UTC/,
    ],
    [
      {
        status: 'skipped',
        error: "waiting for its reader's preferences",
        result: { reason: 'preferences_missing' },
      },
      /skipped: waiting for its reader's preferences/,
    ],
    [
      {
        status: 'ok',
        result: {
          quiet: true,
          answer: 'HEARTBEAT_OK',
          unavailable_sources: { concierge: ['tracker', 'mail'] },
        },
      },
      /could not reach tracker, mail, so it may have missed something\.$/,
    ],
    [
      {
        status: 'ok',
        result: { quiet: false, unavailable_sources: { concierge: ['tracker'] } },
      },
      /missed something\. Anything it found is in its conversation/,
    ],
  ])('says what a run did: %j', async (run, words) => {
    await mount({
      listHeartbeats: reads([row()]),
      runHeartbeat: vi.fn().mockResolvedValue(run),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }));
    await screen.findByText(words);
    expect(screen.queryByText(/daily_cap|preferences_missing/)).toBeNull();
  });

  it('says a run is already going, not that something else changed it', async () => {
    await mount({
      listHeartbeats: reads([row()]),
      runHeartbeat: vi
        .fn()
        .mockRejectedValue(
          new Error('heartbeats/run: 409 {"detail":{"error":"heartbeat_running"}}'),
        ),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }));
    await screen.findByText(/a run of this heartbeat is still going/);
  });

  it('says a heartbeat removed elsewhere is gone, and rereads', async () => {
    const { mocks } = await mount({
      listHeartbeats: reads([row()]),
      runHeartbeat: vi.fn().mockRejectedValue(new Error('heartbeats/run: 404 heartbeat_gone')),
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }));
    await screen.findByText(/this heartbeat is no longer there/);
    expect(mocks.listHeartbeats.mock.calls.length).toBeGreaterThan(1);
  });

  it('says a heartbeat with no offer is gone, rather than vanishing with the refusal', async () => {
    await mount(
      {
        listHeartbeats: vi.fn().mockResolvedValueOnce([row()]).mockResolvedValue([]),
        runHeartbeat: vi.fn().mockRejectedValue(new Error('heartbeats/run: 404 heartbeat_gone')),
      },
      {},
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Run now' }));
    await screen.findByText(/this heartbeat is no longer there/);
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Turn off' })).toBeNull());
    await screen.findByText(/this heartbeat is no longer there/);
  });

  it('asks about everything Remove takes with it', async () => {
    await mount({ listHeartbeats: reads([row()]) });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await screen.findByText(/run history, its preferences and the thread of each run/);
  });

  it('says how long ago it last ran', async () => {
    await mount({ listHeartbeats: reads([row()]) });
    await screen.findByText(/2h ago/);
  });

  it('says when a heartbeat stops for good', async () => {
    await mount({
      listHeartbeats: reads([row({ expires_at: '2026-12-01T00:00:00Z' })]),
    });
    const stops = await screen.findByText(/when the sign-in that turned it on expires/);
    expect(stops.textContent).toContain(new Date('2026-12-01T00:00:00Z').toLocaleString());
  });
});
