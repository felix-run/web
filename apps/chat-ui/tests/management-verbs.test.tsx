/** @vitest-environment happy-dom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Three verbs the harness has always served and nothing here called.
 *
 * Each is the write half of a panel that could already read: memory could be
 * listed, searched and forgotten but not written; plans could be watched but not
 * cleared; a dataset could be run against one manifest but not compared across
 * two. These cover the request each one builds, because the request is the part
 * that has to match a harness in another repository — and the guard that catches
 * a wrong path cannot see a wrong body.
 */

afterEach(cleanup);
beforeEach(() => {
  vi.resetModules();
});

const okJson = (body: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, json: async () => body, text: async () => '' });

describe('addMemory', () => {
  it('sends the shape the harness models, with its defaults filled in', async () => {
    const fetchMock = okJson({ id: 'm1', status: 'active' });
    vi.stubGlobal('fetch', fetchMock);
    const { addMemory } = await import('../src/api');

    await addMemory({ content: 'staging runs on :8081' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/memory');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      content: 'staging runs on :8081',
      kind: 'fact',
      manifest_id: '',
      topic_key: '',
      importance: 0.5,
    });
    vi.unstubAllGlobals();
  });

  it('reports a refusal rather than returning an empty row', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403, text: async () => 'missing scopes' }),
    );
    const { addMemory } = await import('../src/api');
    await expect(addMemory({ content: 'x' })).rejects.toThrow(/403/);
    vi.unstubAllGlobals();
  });
});

describe('deletePlan', () => {
  it('deletes by id and says nothing on success', async () => {
    const fetchMock = okJson({ status: 'deleted' });
    vi.stubGlobal('fetch', fetchMock);
    const { deletePlan } = await import('../src/api');

    await expect(deletePlan('plan-7')).resolves.toBeUndefined();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/plans/plan-7');
    expect(init.method).toBe('DELETE');
    vi.unstubAllGlobals();
  });

  it('escapes an id rather than pasting it into the path', async () => {
    const fetchMock = okJson({ status: 'deleted' });
    vi.stubGlobal('fetch', fetchMock);
    const { deletePlan } = await import('../src/api');

    await deletePlan('a/b?c');
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/api/plans/a%2Fb%3Fc');
    vi.unstubAllGlobals();
  });
});

describe('compareEvalRuns', () => {
  it('names the dataset, the baseline and every candidate', async () => {
    const fetchMock = okJson({
      dataset: 'd',
      baseline: 'baseline',
      results: [],
      judge_threshold: null,
    });
    vi.stubGlobal('fetch', fetchMock);
    const { compareEvalRuns } = await import('../src/api');

    await compareEvalRuns({
      dataset: 'regressions',
      baseline: { name: 'baseline', manifest: 'quick' },
      candidates: [{ name: 'deep', manifest: 'deep' }],
    });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/eval/runs/compare');
    expect(JSON.parse(String(init.body))).toEqual({
      dataset_name: 'regressions',
      baseline: { name: 'baseline', manifest: 'quick' },
      candidates: [{ name: 'deep', manifest: 'deep' }],
    });
    vi.unstubAllGlobals();
  });

  /** Omitted rather than sent as null: the harness reads `is not None`. */
  it('leaves the judge threshold out when there is not one', async () => {
    const fetchMock = okJson({ dataset: 'd', baseline: 'b', results: [], judge_threshold: 0.8 });
    vi.stubGlobal('fetch', fetchMock);
    const { compareEvalRuns } = await import('../src/api');

    await compareEvalRuns({
      dataset: 'd',
      baseline: { manifest: 'quick' },
      candidates: [{ manifest: 'deep' }],
      judgeThreshold: 0.8,
    });
    const body = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect(body.judge_threshold).toBe(0.8);

    fetchMock.mockClear();
    await compareEvalRuns({
      dataset: 'd',
      baseline: { manifest: 'quick' },
      candidates: [{ manifest: 'deep' }],
    });
    const second = JSON.parse(String((fetchMock.mock.calls[0] as [string, RequestInit])[1].body));
    expect('judge_threshold' in second).toBe(false);
    vi.unstubAllGlobals();
  });
});

describe('the memory panel', () => {
  it('stores what is typed and returns to the list', async () => {
    const addMemory = vi.fn().mockResolvedValue({ id: 'm1', status: 'active' });
    vi.doMock('../src/api', () => ({
      addMemory,
      decideApproval: vi.fn(),
      deletePlan: vi.fn(),
      forgetMemory: vi.fn(),
      getToolMetrics: vi.fn().mockResolvedValue({ tools: [] }),
      listApprovals: vi.fn().mockResolvedValue([]),
      listAudit: vi.fn().mockResolvedValue([]),
      listMemories: vi.fn().mockResolvedValue([]),
      listPlans: vi.fn().mockResolvedValue([]),
      listUsage: vi.fn().mockResolvedValue({ items: [], next_cursor: null }),
      memoriesAsOf: vi.fn().mockResolvedValue([]),
      searchMemories: vi.fn().mockResolvedValue([]),
    }));
    const { Inspector } = await import('../src/components/inspector/inspector');

    render(<Inspector open onClose={() => {}} skills={null} onSuggest={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Memory' }));
    fireEvent.click(await screen.findByRole('tab', { name: 'Add' }));
    fireEvent.change(screen.getByLabelText('What to remember'), {
      target: { value: 'staging runs on :8081' },
    });
    fireEvent.click(screen.getByRole('button', { name: /remember it/i }));

    await waitFor(() =>
      expect(addMemory).toHaveBeenCalledWith({
        content: 'staging runs on :8081',
        topicKey: '',
        importance: 0.5,
      }),
    );
    vi.doUnmock('../src/api');
  });
});
