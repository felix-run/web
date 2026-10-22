import { describe, expect, it } from 'vitest';
import { describeError, isClosedApproval } from '../src/errors';

/**
 * A refused send says why. Every 409 used to read as an approval someone else had
 * decided ("no longer pending"), which is how a thread pinned to one agent — refused
 * when the operator picked another — looked like a race nobody could explain.
 */
describe('a send the harness refused', () => {
  it('says which agent a pinned thread belongs to', () => {
    const err = new Error(
      'chat/stream: 409 {"detail":"thread pinned to triage: quick cannot continue it"}',
    );
    expect(describeError(err, 'send this message').message).toBe(
      'Could not send this message: this thread is pinned to triage, so quick cannot continue it. Switch back to triage, or start a new chat for quick.',
    );
  });

  it('says a pinned agent changed since the thread started on it', () => {
    const err = new Error(
      'chat/stream: 409 {"detail":"manifest hash drift for triage: pinned=45e05bfadbb7… current=0021fafa0b45…"}',
    );
    expect(describeError(err, 'send this message').message).toContain(
      'pinned to the build of triage it started on',
    );
  });

  it('gives any other refusal in the harness’s own words', () => {
    const err = new Error('chat/stream: 409 {"detail":"something_new"}');
    expect(describeError(err, 'send this message').message).toBe(
      'Could not send this message: the harness refused it (something_new).',
    );
  });

  it('leaves the approval wording to everything else', () => {
    const err = new Error('decide: 409 already decided');
    expect(describeError(err, 'approve this').message).toContain('no longer pending');
  });
});

/**
 * Refusals the harness names with a code (`felix-run/felix#635`). The status alone read a
 * timed-out approval as someone else's decision, and a non-writer's Run now as a key
 * missing a scope that no scope grants.
 */
describe('a refusal the harness names', () => {
  it('says an approval timed out rather than that someone decided it', () => {
    const err = new Error('decide: 409 {"detail":"approval_expired"}');
    expect(describeError(err, 'approve write_file').message).toBe(
      'Could not approve write_file: its deadline passed before the decision arrived, so the harness denied it on timeout.',
    );
  });

  it('says someone else decided it', () => {
    const err = new Error('decide: 409 {"detail":"approval_already_decided"}');
    expect(describeError(err, 'deny write_file').message).toContain('someone already decided it');
  });

  it('says the requester cannot decide their own call, not that the key lacks a scope', () => {
    const err = new Error('decide: 403 {"detail":"self_approval_forbidden"}');
    const { message } = describeError(err, 'approve write_file');
    expect(message).toContain('someone other than whoever started the run');
    expect(message).not.toContain('scope');
  });

  it('says who may run a job by hand', () => {
    const err = new Error('jobs /nightly/run: 403 {"detail":"not_job_writer"}');
    expect(describeError(err, 'run nightly').message).toContain(
      'only whoever last saved this job, or an operator',
    );
  });

  it('treats only a decided or expired approval as closed', () => {
    expect(isClosedApproval(new Error('decide: 409 {"detail":"approval_expired"}'))).toBe(true);
    expect(isClosedApproval(new Error('decide: 409 {"detail":"approval_already_decided"}'))).toBe(
      true,
    );
    expect(isClosedApproval(new Error('decide: 403 {"detail":"self_approval_forbidden"}'))).toBe(
      false,
    );
    expect(isClosedApproval(new Error('decide: 500'))).toBe(false);
  });
});
