// @vitest-environment happy-dom
import type { SkillEval, SkillFeedback, SkillPolicy, ToolCall } from '@felix/client';
import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Tool } from '../src/components/chat/tool';
import { EvalRow } from '../src/components/skills/evals-panel';
import { FeedbackRow, feedbackFailure } from '../src/components/skills/feedback-panel';
import { PolicyEditor, policyPatch } from '../src/components/skills/policy-form';
import { JOB_POLL_MS, STALL_MS } from '../src/components/skills/queries';
import { policySentence } from '../src/components/skills/refusal';
import { SaveDialog } from '../src/components/skills/save-dialog';
import { SkillLibrary, SkillLibraryPage } from '../src/components/skills/skill-library';
import { VersionDecision } from '../src/components/skills/version-actions';
import {
  fakeHarness,
  fileBody,
  mountWithProviders,
  type Recorded,
  SKILL_MD,
  versionRow,
} from './skill-fixtures';

/**
 * The quality loop in the library: evaluations, feedback, the tenant policy,
 * and publishes pinned to the live version the operator was shown. Each case
 * is asserted where it would mislead if wrong — what is sent, and what a row
 * claims about the gate.
 */

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const ID = '0f8e2c1a-4b3d-4e5f-8a9b-0c1d2e3f4a5b';

function evaluation(over: Partial<SkillEval> = {}): SkillEval {
  return {
    id: ID,
    name: 'roll-dice',
    version: '0.1.1',
    status: 'succeeded',
    scenario_source: 'bundle',
    scenarios: [],
    baseline_score: 40,
    with_skill_score: 72,
    uplift: 32,
    results: [
      {
        name: 'two-dice',
        baseline_score: 40,
        with_skill_score: 72,
        uplift: 32,
        baseline_reason: 'Guessed.',
        with_skill_reason: 'Rolled both.',
      },
    ],
    model: 'quick',
    judge_model: 'judge',
    error: null,
    requested_by: 'ops',
    created_at: Date.now() - 60_000,
    started_at: null,
    heartbeat_at: null,
    attempts: 1,
    finished_at: null,
    counts_for_gate: true,
    gate_note: '',
    ...over,
  };
}

function feedback(over: Partial<SkillFeedback> = {}): SkillFeedback {
  return {
    id: ID,
    name: 'roll-dice',
    target_version: '0.1.0',
    source: 'human',
    author: 'ops',
    principal: 'ops',
    body: 'Say how many dice.',
    suggested_patch: null,
    status: 'pending',
    improve: true,
    result_version: null,
    model: null,
    error: null,
    created_at: Date.now() - 60_000,
    claimed_at: null,
    heartbeat_at: null,
    attempts: 0,
    decided_at: null,
    decided_by: null,
    decision_note: null,
    ...over,
  };
}

const detail = (live: string | null, versions = [versionRow({ version: '0.1.1' })]) => ({
  name: 'roll-dice',
  live_version: live,
  created_by: 'ops',
  created_at: 1,
  updated_at: 2,
  shadows_operator_upload: false,
  versions,
});

describe('evaluations', () => {
  it('says plainly whether an evaluation counts for the gate, and why not', () => {
    mountWithProviders(
      <ul>
        <EvalRow evaluation={evaluation()} />
        <EvalRow
          evaluation={evaluation({
            id: 'b',
            scenario_source: 'generated',
            counts_for_gate: false,
            gate_note: "an agent's version counts only an evaluation on its bundle's own evals/",
          })}
        />
      </ul>,
    );
    const [counted, not] = screen.getAllByRole('listitem');
    expect(counted?.textContent).toContain('Counts for the publish gate.');
    expect(counted?.textContent).toMatch(/40.*→.*72.*uplift\s*\+32/);
    expect(not?.textContent).toContain(
      "Does not count for the publish gate: an agent's version counts only an evaluation on its bundle's own evals/",
    );
    expect(not?.textContent).toContain('scenarios the model generated');
  });

  it('shows the attempts and the error of a failed evaluation, and the reasons per scenario', () => {
    mountWithProviders(
      <ul>
        <EvalRow
          evaluation={evaluation({
            status: 'failed',
            attempts: 3,
            error: 'attempts_exhausted',
            counts_for_gate: false,
            gate_note: 'only a succeeded evaluation counts',
          })}
        />
      </ul>,
    );
    expect(screen.getByText(/Failed after 3 attempts/).textContent).toContain('attempts_exhausted');
    fireEvent.click(screen.getByRole('button', { name: '1 scenario' }));
    expect(screen.getByText('Rolled both.')).toBeTruthy();
  });

  it('polls an evaluation in flight, and stops once it has finished', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let reads = 0;
    const h = fakeHarness((req: Recorded) => {
      if (req.path === '/skill-library/roll-dice') return { body: detail(null) };
      if (req.path.startsWith('/skill-library/roll-dice/evals')) {
        if (req.path.includes('version=')) reads++;
        const status = reads >= 2 ? 'succeeded' : 'running';
        return { body: { items: [evaluation({ status })], next_cursor: null } };
      }
      if (req.path === '/skill-library/-/policy') return { body: { require_eval: false } };
      return undefined;
    });
    mountWithProviders(<SkillLibraryPage />, '/harness/skills?skill=roll-dice&tab=evals');
    expect(await screen.findByText('running')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOB_POLL_MS + 100);
    });
    expect(await screen.findByText('succeeded')).toBeTruthy();
    const after = reads;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOB_POLL_MS * 4);
    });
    expect(reads).toBe(after);
    expect(h.requests.some((r) => r.method === 'POST')).toBe(false);
  });

  it('queues an evaluation of the selected version, and says when one is already in flight', async () => {
    const h = fakeHarness((req: Recorded) => {
      if (req.path === '/skill-library/roll-dice') return { body: detail(null) };
      if (req.method === 'POST' && req.path.endsWith('/eval')) {
        return { status: 409, body: { error: 'eval_in_progress', message: 'one is running' } };
      }
      if (req.path.startsWith('/skill-library/roll-dice/evals')) {
        return { body: { items: [], next_cursor: null } };
      }
      if (req.path === '/skill-library/-/policy') return { body: {} };
      return undefined;
    });
    mountWithProviders(<SkillLibraryPage />, '/harness/skills?skill=roll-dice&tab=evals');
    fireEvent.click(await screen.findByRole('button', { name: 'Evaluate 0.1.1' }));
    expect(await screen.findByText(/already has an evaluation queued or running/)).toBeTruthy();
    expect(h.requests.find((r) => r.method === 'POST')?.path).toBe(
      '/skill-library/roll-dice/versions/0.1.1/eval',
    );
  });
});

describe('feedback', () => {
  function harnessWith(items: SkillFeedback[]) {
    return fakeHarness((req: Recorded) => {
      if (req.path === '/skill-library/roll-dice') return { body: detail('0.1.1') };
      if (req.path.startsWith('/skill-library/roll-dice/feedback') && req.method === 'GET') {
        return { body: { items, next_cursor: null } };
      }
      if (req.method === 'POST') return { body: feedback({ status: 'accepted' }) };
      return undefined;
    });
  }

  it('accepts with "improve with AI" on by default, or off, and rejects with a note', async () => {
    const h = harnessWith([feedback()]);
    mountWithProviders(<SkillLibraryPage />, '/harness/skills?skill=roll-dice&tab=feedback');
    const list = await screen.findByRole('list', { name: 'Feedback on roll-dice' });
    expect((within(list).getByLabelText(/Improve with AI/) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(list).getByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect(h.requests.find((r) => r.path.endsWith('/accept'))?.body).toEqual({ improve: true }),
    );
    fireEvent.click(within(list).getByLabelText(/Improve with AI/));
    fireEvent.click(within(list).getByRole('button', { name: 'Accept' }));
    await waitFor(() =>
      expect(h.requests.filter((r) => r.path.endsWith('/accept'))[1]?.body).toEqual({
        improve: false,
      }),
    );
    fireEvent.click(within(list).getByRole('button', { name: 'Reject…' }));
    fireEvent.change(within(list).getByLabelText(/^Why reject it\?/), { target: { value: 'No' } });
    fireEvent.click(within(list).getByRole('button', { name: 'Reject feedback' }));
    await waitFor(() =>
      expect(
        h.requests.find((r) => r.path === `/skill-library/-/feedback/${ID}/reject`)?.body,
      ).toEqual({
        note: 'No',
      }),
    );
  });

  it('files feedback on the version chosen, with an optional patch', async () => {
    const h = harnessWith([]);
    mountWithProviders(<SkillLibraryPage />, '/harness/skills?skill=roll-dice&tab=feedback');
    fireEvent.change(await screen.findByLabelText('What should change, and why'), {
      target: { value: 'Too terse' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'File feedback' }));
    await waitFor(() =>
      expect(h.requests.find((r) => r.method === 'POST')?.body).toEqual({
        body: 'Too terse',
        target_version: '0.1.1',
      }),
    );
  });

  it('links applied feedback to its draft and the diff, and loads it into the editor on request', async () => {
    const apply = vi.fn();
    fakeHarness(() => undefined);
    mountWithProviders(
      <ul>
        <FeedbackRow
          feedback={feedback({ status: 'applied', result_version: '0.1.2', model: 'quick' })}
          onApplyToEditor={apply}
        />
      </ul>,
    );
    expect(screen.getByRole('link', { name: 'roll-dice 0.1.2' }).getAttribute('href')).toBe(
      '/harness/skills?skill=roll-dice&tab=versions&v=0.1.2&against=0.1.0',
    );
    expect(screen.getByRole('button', { name: 'AI draft against 0.1.0' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Apply to editor' }));
    fireEvent.click(screen.getByRole('button', { name: 'Load 0.1.2' }));
    await waitFor(() => expect(apply).toHaveBeenCalledWith('0.1.2'));
  });

  it('explains a failed improvement in words', () => {
    expect(feedbackFailure('parent_rejected: roll-dice@0.1.0 was rejected')).toMatch(
      /was rejected/,
    );
    expect(feedbackFailure('parent_changed: roll-dice is at 0.1.3')).toMatch(/newer version/);
    expect(feedbackFailure('attempts_exhausted')).toMatch(/three times/);
    mountWithProviders(
      <ul>
        <FeedbackRow
          feedback={feedback({ status: 'failed', attempts: 3, error: 'attempts_exhausted' })}
        />
      </ul>,
    );
    expect(screen.getByText(/After 3 attempts/)).toBeTruthy();
  });
});

describe('the publish policy', () => {
  const policy = (over: Partial<SkillPolicy> = {}): SkillPolicy => ({
    min_quality: 60,
    block_on_advisory: true,
    security_fail_blocks: true,
    require_eval: false,
    min_eval_uplift: 5,
    source: 'tenant+settings',
    tenant_values: {
      min_quality: 40,
      block_on_advisory: true,
      require_eval: false,
      min_eval_uplift: 5,
    },
    updated_at: 1,
    updated_by: 'ops',
    ...over,
  });

  it("is changed on the library page, and only stated on a skill's gate", async () => {
    fakeHarness((req: Recorded) => {
      if (req.path === '/skill-library/-/policy') return { body: policy() };
      if (req.path.startsWith('/skill-library/-/review'))
        return { body: { items: [], next_cursor: null } };
      if (req.path.startsWith('/skill-library/-/feedback'))
        return { body: { items: [], next_cursor: null } };
      if (req.path.startsWith('/skill-library?')) return { body: { items: [], next_cursor: null } };
      if (req.path === '/skill-library/roll-dice') return { body: detail('0.1.0') };
      if (req.path.endsWith('/preview'))
        return {
          body: {
            name: 'roll-dice',
            version: '0.1.1',
            status: 'draft',
            valid: true,
            validation_issues: [],
            quality_score: 80,
            review_checks: [],
            security_status: 'pass',
            security_issues: [],
            policy_passes: true,
            reasons: [],
          },
        };
      return undefined;
    });
    const { unmount } = mountWithProviders(<SkillLibrary />, '/harness/skills');
    expect(await screen.findByRole('heading', { name: 'Publish policy' })).toBeTruthy();
    expect(await screen.findByRole('button', { name: 'Edit policy…' })).toBeTruthy();
    unmount();
    mountWithProviders(<SkillLibraryPage />, '/harness/skills?skill=roll-dice&tab=review');
    expect(await screen.findByText(/The gate would let 0\.1\.1 through/)).toBeTruthy();
    expect(await screen.findByRole('link', { name: 'change it on the library page' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Edit policy…' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'Gate' })).toBeTruthy();
  });

  it('marks where the deployment floor outvoted the tenant, and says tighten-only', () => {
    fakeHarness(() => undefined);
    mountWithProviders(<PolicyEditor policy={policy()} />);
    const row = screen.getByRole('row', { name: /Minimum quality/ });
    expect(row.textContent).toContain('40');
    expect(row.textContent).toContain('60');
    expect(row.textContent).toContain('(deployment floor)');
    expect(screen.getByRole('row', { name: /Block on an advisory/ }).textContent).not.toContain(
      'deployment floor',
    );
    expect(document.body.textContent).toContain('never lower it below the deployment');
  });

  it('PATCHes only the fields changed, with an emptied uplift as null', async () => {
    const h = fakeHarness(() => ({ body: policy() }));
    mountWithProviders(<PolicyEditor policy={policy()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit policy…' }));
    fireEvent.change(screen.getByLabelText(/Minimum quality, 0-100/), { target: { value: '80' } });
    fireEvent.change(screen.getByLabelText(/Minimum evaluation uplift/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save policy' }));
    await waitFor(() =>
      expect(h.requests.find((r) => r.method === 'PATCH')?.body).toEqual({
        min_quality: 80,
        min_eval_uplift: null,
      }),
    );
  });

  it('resets to the deployment defaults with DELETE, after confirming', async () => {
    const h = fakeHarness(() => ({ body: policy({ source: 'settings', tenant_values: null }) }));
    mountWithProviders(<PolicyEditor policy={policy()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reset to deployment defaults' }));
    expect(h.requests).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Reset to deployment defaults' }));
    await waitFor(() => expect(h.requests.map((r) => r.method)).toEqual(['DELETE']));
  });

  it('builds a patch from the difference alone, and words the evaluation rules', () => {
    const start = {
      min_quality: 40,
      block_on_advisory: false,
      require_eval: false,
      min_eval_uplift: 5,
    };
    expect(policyPatch(start, start)).toEqual({});
    expect(policyPatch(start, { ...start, require_eval: true, min_eval_uplift: null })).toEqual({
      require_eval: true,
      min_eval_uplift: null,
    });
    expect(policySentence(policy())).toContain('with an uplift of at least +5');
    expect(policySentence(policy({ min_eval_uplift: null, require_eval: true }))).toContain(
      'a succeeded evaluation that counts for the gate',
    );
  });
});

describe('a publish pinned to the live version it named', () => {
  it('re-asks naming the new live version after live_changed, and never retries by itself', async () => {
    let live = '0.1.0';
    const h = fakeHarness((req: Recorded) => {
      if (req.path === '/skill-library/roll-dice') return { body: detail(live) };
      if (req.method === 'POST' && req.path.endsWith('/publish')) {
        const expected = (req.body as { expected_live_version: string | null })
          .expected_live_version;
        if (expected !== live) {
          return { status: 409, body: { error: 'live_changed', message: `live is ${live}` } };
        }
        return { body: versionRow({ version: '0.1.3', status: 'published' }) };
      }
      return undefined;
    });
    mountWithProviders(<VersionDecision name="roll-dice" version="0.1.3" liveVersion="0.1.0" />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish 0.1.3' }));
    await screen.findByText(/replacing live 0\.1\.0/);
    // Someone else publishes in between.
    live = '0.1.2';
    fireEvent.click(screen.getByRole('button', { name: 'Publish 0.1.3' }));
    expect(await screen.findByText(/live moved from 0\.1\.0 to 0\.1\.2/)).toBeTruthy();
    expect(screen.getByText(/replacing live 0\.1\.2/)).toBeTruthy();
    await new Promise((r) => setTimeout(r, 30));
    const publishes = () => h.requests.filter((r) => r.path.endsWith('/publish'));
    expect(publishes()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Publish 0.1.3' }));
    await waitFor(() => expect(publishes()).toHaveLength(2));
    expect(publishes()[1]?.body).toEqual({ expected_live_version: '0.1.2' });
  });

  it('sends null when nothing was live', async () => {
    const h = fakeHarness((req: Recorded) =>
      req.path === '/skill-library/roll-dice'
        ? { body: detail(null) }
        : { body: versionRow({ version: '0.1.0' }) },
    );
    mountWithProviders(<VersionDecision name="roll-dice" version="0.1.0" liveVersion={null} />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish 0.1.0' }));
    await screen.findByText(/as its first live version/);
    fireEvent.click(screen.getByRole('button', { name: 'Publish 0.1.0' }));
    await waitFor(() =>
      expect(h.requests.find((r) => r.path.endsWith('/publish'))?.body).toEqual({
        expected_live_version: null,
      }),
    );
  });
});

describe('parent_rejected', () => {
  it('says on the card that nothing was saved because the parent was rejected', async () => {
    fakeHarness(() => undefined);
    const tool: ToolCall = {
      name: 'update_skill',
      input: { name: 'roll-dice', parent_version: '0.1.2' },
      output: JSON.stringify({
        error: 'parent_rejected',
        name: 'roll-dice',
        expected: '0.1.2',
        current: '0.1.1',
      }),
      done: true,
    };
    mountWithProviders(<Tool tool={tool} />);
    const card = (await screen.findByText('not saved')).closest('div.rounded-xl') as HTMLElement;
    expect(card.textContent).toMatch(/0\.1\.2, which a person rejected\. Nothing was saved/);
    expect(card.textContent).toContain('0.1.1');
  });
});

describe('review fixes', () => {
  const policyOf = (): SkillPolicy => ({
    min_quality: 40,
    block_on_advisory: false,
    security_fail_blocks: true,
    require_eval: false,
    min_eval_uplift: null,
    source: 'tenant',
    tenant_values: {
      min_quality: 40,
      block_on_advisory: false,
      require_eval: false,
      min_eval_uplift: null,
    },
    updated_at: 1,
    updated_by: 'ops',
  });

  it.each([
    '',
    '   ',
    '0x10',
    '1e2',
    '4.5',
  ])('keeps Save disabled for a quality of %j rather than saving it as a number', (value) => {
    fakeHarness(() => ({ body: policyOf() }));
    mountWithProviders(<PolicyEditor policy={policyOf()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit policy…' }));
    fireEvent.change(screen.getByLabelText(/Minimum quality, 0-100/), { target: { value } });
    expect(
      (screen.getByRole('button', { name: 'Save policy' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('refuses a hex or exponent uplift too', () => {
    fakeHarness(() => ({ body: policyOf() }));
    mountWithProviders(<PolicyEditor policy={policyOf()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit policy…' }));
    fireEvent.change(screen.getByLabelText(/Minimum evaluation uplift/), {
      target: { value: '1e1' },
    });
    expect(
      (screen.getByRole('button', { name: 'Save policy' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('re-reads the cross-version list once the polled evaluation finishes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let reads = 0;
    let crossReads = 0;
    fakeHarness((req: Recorded) => {
      if (req.path === '/skill-library/roll-dice') return { body: detail(null) };
      if (req.path.startsWith('/skill-library/roll-dice/evals')) {
        if (req.path.includes('version=')) reads++;
        else crossReads++;
        const status = reads >= 2 ? 'succeeded' : 'running';
        return {
          body: { items: [evaluation({ status, started_at: Date.now() })], next_cursor: null },
        };
      }
      if (req.path === '/skill-library/-/policy') return { body: {} };
      return undefined;
    });
    mountWithProviders(<SkillLibraryPage />, '/harness/skills?skill=roll-dice&tab=evals');
    await screen.findByText('running');
    const before = crossReads;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOB_POLL_MS + 100);
    });
    await screen.findByText('succeeded');
    await waitFor(() => expect(crossReads).toBeGreaterThan(before));
  });

  it('stops polling a job that has not moved in five minutes, says why, and checks again on request', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const queuedAt = Date.now();
    let reads = 0;
    fakeHarness((req: Recorded) => {
      if (req.path === '/skill-library/roll-dice') return { body: detail(null) };
      if (req.path.startsWith('/skill-library/roll-dice/evals')) {
        if (req.path.includes('version=')) reads++;
        return {
          body: {
            items: [evaluation({ status: 'queued', created_at: queuedAt })],
            next_cursor: null,
          },
        };
      }
      if (req.path === '/skill-library/-/policy') return { body: {} };
      return undefined;
    });
    mountWithProviders(<SkillLibraryPage />, '/harness/skills?skill=roll-dice&tab=evals');
    await screen.findByText('queued');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(STALL_MS + JOB_POLL_MS * 2);
    });
    expect(await screen.findByText(/hasn’t picked this up in five minutes/)).toBeTruthy();
    const stopped = reads;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(JOB_POLL_MS * 10);
    });
    expect(reads).toBe(stopped);
    fireEvent.click(screen.getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(reads).toBe(stopped + 1));
  });

  it('arms against the live version the server reports, not the stale one it was handed', async () => {
    const h = fakeHarness((req: Recorded) =>
      req.path === '/skill-library/roll-dice'
        ? { body: detail('0.1.2') }
        : { body: versionRow({ version: '0.1.3', status: 'published' }) },
    );
    mountWithProviders(<VersionDecision name="roll-dice" version="0.1.3" liveVersion="0.1.0" />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish 0.1.3' }));
    expect(await screen.findByText(/replacing live 0\.1\.2/)).toBeTruthy();
    expect(screen.queryByText(/replacing live 0\.1\.0/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Publish 0.1.3' }));
    await waitFor(() =>
      expect(h.requests.find((r) => r.path.endsWith('/publish'))?.body).toEqual({
        expected_live_version: '0.1.2',
      }),
    );
  });

  describe('Apply to editor, on the page', () => {
    const DRAFT = SKILL_MD('roll-dice', '# Steps\n\n1. Roll.\n2. Link each line to its PR.\n');
    function harness() {
      return fakeHarness((req: Recorded) => {
        if (req.path === '/skill-library/roll-dice') {
          return {
            body: detail('0.1.0', [
              versionRow({ version: '0.1.2', parent_version: '0.1.0' }),
              versionRow({ version: '0.1.0', status: 'published' }),
            ]),
          };
        }
        if (req.path.startsWith('/skill-library/roll-dice/feedback')) {
          return {
            body: {
              items: [feedback({ status: 'applied', result_version: '0.1.2' })],
              next_cursor: null,
            },
          };
        }
        const v = /^\/skill-library\/roll-dice\/versions\/(\d+\.\d+\.\d+)$/.exec(req.path);
        if (v) {
          return {
            body: {
              ...versionRow({ version: v[1] }),
              review_checks: [],
              security_issues: [],
              files: [{ path: 'SKILL.md', sha256: v[1], size: 1 }],
              shadows_operator_upload: false,
            },
          };
        }
        if (req.path === '/skill-library/roll-dice/versions/0.1.2/files/SKILL.md') {
          return { body: fileBody('SKILL.md', DRAFT) };
        }
        if (req.method === 'PUT') {
          return {
            status: 201,
            body: {
              ...versionRow({ version: '0.1.3', parent_version: '0.1.2' }),
              review_checks: [],
              security_issues: [],
              files: [{ path: 'SKILL.md', sha256: 'x', size: 1 }],
              shadows_operator_upload: false,
              published: false,
              publish_blocked: null,
            },
          };
        }
        return undefined;
      });
    }

    async function apply() {
      fireEvent.click(await screen.findByRole('tab', { name: 'Feedback' }));
      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Feedback' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Apply to editor' }));
      fireEvent.click(screen.getByRole('button', { name: 'Load 0.1.2' }));
      const source = (await screen.findByLabelText('SKILL.md source')) as HTMLTextAreaElement;
      await waitFor(() => expect(source.value).toBe(DRAFT));
      return source;
    }

    it('loads the draft into the editor, and the next save names it as the parent', async () => {
      const h = harness();
      mountWithProviders(<SkillLibraryPage />, '/harness/skills?skill=roll-dice&tab=feedback');
      const source = await apply();
      fireEvent.change(source, { target: { value: `${DRAFT}3. Done.\n` } });
      fireEvent.click(screen.getByRole('button', { name: /Save version/ }));
      const dialog = await screen.findByRole('dialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Save 0.1.3' }));
      await waitFor(() =>
        expect(
          (h.requests.find((r) => r.method === 'PUT')?.body as { parent_version: string })
            .parent_version,
        ).toBe('0.1.2'),
      );
    });

    it('discards unsaved edits when the same draft is applied a second time', async () => {
      harness();
      mountWithProviders(<SkillLibraryPage />, '/harness/skills?skill=roll-dice&tab=feedback');
      const source = await apply();
      fireEvent.change(source, { target: { value: `${DRAFT}unsaved\n` } });
      const again = await apply();
      expect(again.value).toBe(DRAFT);
      expect(document.body.textContent).not.toContain('unsaved changes');
    });
  });
});

describe('the decision states the evidence', () => {
  const preview = (passes: boolean, reasons: string[] = []) => ({
    name: 'roll-dice',
    version: '0.1.1',
    status: 'draft',
    valid: true,
    validation_issues: [],
    quality_score: passes ? 80 : 40,
    review_checks: [],
    security_status: 'pass',
    security_issues: [],
    policy_passes: passes,
    reasons,
  });

  it("states the gate's verdict in the publish confirm, read fresh beside what is live", async () => {
    const h = fakeHarness((req: Recorded) =>
      req.path === '/skill-library/roll-dice'
        ? { body: detail('0.1.0') }
        : req.path.endsWith('/preview')
          ? { body: preview(false, ['quality 40 < 60.']) }
          : undefined,
    );
    mountWithProviders(<VersionDecision name="roll-dice" version="0.1.1" liveVersion="0.1.0" />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish 0.1.1' }));
    expect(await screen.findByText('The gate would refuse 0.1.1: quality 40 < 60.')).toBeTruthy();
    expect(screen.getByText(/replacing live 0\.1\.0/)).toBeTruthy();
    expect(h.requests.some((r) => r.path.endsWith('/versions/0.1.1/preview'))).toBe(true);
  });

  it('still asks when the verdict cannot be read, and says so', async () => {
    fakeHarness((req: Recorded) =>
      req.path === '/skill-library/roll-dice' ? { body: detail('0.1.0') } : undefined,
    );
    mountWithProviders(<VersionDecision name="roll-dice" version="0.1.1" liveVersion="0.1.0" />);
    fireEvent.click(screen.getByRole('button', { name: 'Publish 0.1.1' }));
    expect(await screen.findByText(/verdict could not be read/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Publish 0.1.1' })).toBeTruthy();
  });

  it('names what a save-and-publish replaces, read fresh, and says it publishes', async () => {
    fakeHarness((req: Recorded) =>
      req.path === '/skill-library/roll-dice' ? { body: detail('0.1.0') } : undefined,
    );
    mountWithProviders(
      <SaveDialog
        name="roll-dice"
        open
        onOpenChange={() => {}}
        parent="0.1.1"
        bodyBytes={100}
        busy={false}
        onSave={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Save 0.1.2' })).toBeTruthy();
    fireEvent.click(screen.getByLabelText(/Publish now/));
    expect(
      await screen.findByText(/roll-dice 0\.1\.2 goes live, replacing live 0\.1\.0/),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save and publish 0.1.2' })).toBeTruthy();
  });
});

describe('a link to no skill', () => {
  it('draws no tab strip over the not-found line', async () => {
    fakeHarness(() => ({ status: 404, body: { error: 'not_found', message: 'no such skill' } }));
    mountWithProviders(<SkillLibraryPage />, '/harness/skills?skill=does-not-exist');
    expect(await screen.findByText(/has no skill called/)).toBeTruthy();
    expect(screen.queryByRole('tablist')).toBeNull();
  });
});
