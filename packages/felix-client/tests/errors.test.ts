import { describe, expect, it } from 'vitest';
import { describeError } from '../src/errors';

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
