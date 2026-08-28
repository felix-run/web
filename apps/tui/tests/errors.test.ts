import { describe, expect, it } from 'vitest';
import type { Config } from '../src/config';
import { explainError } from '../src/errors';

/**
 * A 401 is the one message the shared copy gets wrong here.
 *
 * The browser client answers it by re-opening the shared-key gate, so "enter it
 * again" is a real instruction there. In a terminal it is not, and the useful
 * distinction is one the wire cannot make: a first run with no key at all, and a
 * key that has been rotated, are the same 401 and need opposite advice.
 */

const base: Config = {
  origin: 'http://localhost:8080',
  manifest: 'quick',
  yes: false,
  insecure: false,
};

describe('explainError', () => {
  it('names the flag when no key is configured', () => {
    const message = explainError(new Error('models: 401'), 'list the agents', base);
    expect(message).toContain('--key');
    expect(message).toContain('FELIX_API_KEY');
    expect(message).not.toContain('Enter it again');
  });

  it('says the key was rejected when one is configured', () => {
    const message = explainError(new Error('models: 401'), 'list the agents', {
      ...base,
      apiKey: 'sk-wrong',
    });
    expect(message).toContain('rejected');
    expect(message).toContain('http://localhost:8080');
  });

  it('leaves every other failure to the shared wording', () => {
    expect(explainError(new Error('chat/stream: 503'), 'start the run', base)).toBe(
      'The harness failed while trying to start the run. This is usually transient, so it is worth retrying.',
    );
  });
});
