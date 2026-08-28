import { describe, expect, it } from 'vitest';
import {
  authHeaders,
  configPath,
  DEFAULT_MANIFEST,
  DEFAULT_ORIGIN,
  insecureOrigin,
  parseArgs,
  resolveConfig,
} from '../src/config';

/**
 * Where the harness is, and how the answer is arrived at.
 *
 * The precedence is the part worth pinning: someone who exports `FELIX_ORIGIN`
 * for a session and then passes `--origin` once expects the flag to win, and
 * someone with a config file expects the environment to override it. Getting
 * that backwards sends a conversation to the wrong deployment, which looks like
 * an empty thread list rather than a mistake.
 */

const noFile = () => ({});

describe('parseArgs', () => {
  it('reads both spellings of a valued flag', () => {
    expect(parseArgs(['--origin', 'http://a', '--manifest=deep']).flags).toEqual({
      origin: 'http://a',
      manifest: 'deep',
    });
  });

  it('treats a flag with no value as a switch', () => {
    expect(parseArgs(['--yes']).flags).toEqual({ yes: true });
  });

  it('does not swallow the next flag as a value', () => {
    expect(parseArgs(['--yes', '--manifest', 'deep']).flags).toEqual({
      yes: true,
      manifest: 'deep',
    });
  });

  it('keeps everything else as the first message', () => {
    expect(parseArgs(['--yes', 'explain', 'the', 'worker']).rest).toEqual([
      'explain',
      'the',
      'worker',
    ]);
  });
});

describe('resolveConfig', () => {
  it('falls back to localhost and the default manifest', () => {
    const { config } = resolveConfig([], {}, noFile);
    expect(config.origin).toBe(DEFAULT_ORIGIN);
    expect(config.manifest).toBe(DEFAULT_MANIFEST);
    expect(config.apiKey).toBeUndefined();
  });

  it('prefers a flag over the environment, and the environment over the file', () => {
    const file = () => ({ origin: 'http://from-file', manifest: 'from-file' });
    const env = { FELIX_ORIGIN: 'http://from-env', FELIX_MANIFEST: 'from-env' };

    expect(resolveConfig(['--origin', 'http://from-flag'], env, file).config).toMatchObject({
      origin: 'http://from-flag',
      manifest: 'from-env',
    });
    expect(resolveConfig([], env, file).config.origin).toBe('http://from-env');
    expect(resolveConfig([], {}, file).config.origin).toBe('http://from-file');
  });

  /** The harness's own spelling, which is what people copy out of a compose file. */
  it('accepts FELIX_AUTH_API_KEYS as the key', () => {
    const { config } = resolveConfig([], { FELIX_AUTH_API_KEYS: 'sk-felix-local' }, noFile);
    expect(config.apiKey).toBe('sk-felix-local');
    expect(authHeaders(config)).toEqual({ authorization: 'Bearer sk-felix-local' });
  });

  it('sends no authorization header at all when nothing is configured', () => {
    // Correct against a harness running FELIX_AUTH_MODE=none.
    expect(authHeaders(resolveConfig([], {}, noFile).config)).toEqual({});
  });

  it('strips a trailing slash so route building never doubles it', () => {
    expect(resolveConfig(['--origin', 'http://a:8080/'], {}, noFile).config.origin).toBe(
      'http://a:8080',
    );
  });

  it('takes the leftover words as the first message', () => {
    const { firstMessage } = resolveConfig(['--yes', 'explain', 'this'], {}, noFile);
    expect(firstMessage).toBe('explain this');
  });
});

describe('configPath', () => {
  it('honours XDG_CONFIG_HOME', () => {
    expect(configPath({ XDG_CONFIG_HOME: '/tmp/cfg' })).toBe('/tmp/cfg/felix/config.json');
  });
});

describe('insecureOrigin', () => {
  const withKey = (origin: string, insecure = false) => ({
    origin,
    manifest: 'quick',
    yes: false,
    insecure,
    apiKey: 'sk-felix',
  });

  it('allows plaintext to loopback, which is the whole local dev story', () => {
    expect(insecureOrigin(withKey('http://localhost:8080'))).toBeNull();
    expect(insecureOrigin(withKey('http://127.0.0.1:8080'))).toBeNull();
  });

  it('allows https anywhere', () => {
    expect(insecureOrigin(withKey('https://felix.example.com'))).toBeNull();
  });

  /** The key would cross the network in the clear. */
  it('refuses plaintext to a remote host', () => {
    expect(insecureOrigin(withKey('http://felix.example.com'))).toContain('plaintext');
  });

  it('yields to --insecure, for an operator who knows the link is private', () => {
    expect(insecureOrigin(withKey('http://felix.example.com', true))).toBeNull();
  });

  it('has nothing to protect when no key is configured', () => {
    expect(
      insecureOrigin({
        origin: 'http://felix.example.com',
        manifest: 'quick',
        yes: false,
        insecure: false,
      }),
    ).toBeNull();
  });
});
