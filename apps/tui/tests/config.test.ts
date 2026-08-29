import { describe, expect, it } from 'bun:test';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  authHeaders,
  configPath,
  DEFAULT_MANIFEST,
  DEFAULT_ORIGIN,
  insecureOrigin,
  parseArgs,
  readDevVars,
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

/** No files at all: a test must not depend on the machine it runs on. */
const noFiles = { userConfig: () => ({}), devVars: () => ({}) };

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
    const { config } = resolveConfig([], {}, noFiles);
    expect(config.origin).toBe(DEFAULT_ORIGIN);
    expect(config.manifest).toBe(DEFAULT_MANIFEST);
    expect(config.apiKey).toBeUndefined();
  });

  it('prefers a flag over the environment, and the environment over the file', () => {
    const file = () => ({ origin: 'http://from-file', manifest: 'from-file' });
    const env = { FELIX_ORIGIN: 'http://from-env', FELIX_MANIFEST: 'from-env' };

    expect(
      resolveConfig(['--origin', 'http://from-flag'], env, { ...noFiles, userConfig: file }).config,
    ).toMatchObject({
      origin: 'http://from-flag',
      manifest: 'from-env',
    });
    expect(resolveConfig([], env, { ...noFiles, userConfig: file }).config.origin).toBe(
      'http://from-env',
    );
    expect(resolveConfig([], {}, { ...noFiles, userConfig: file }).config.origin).toBe(
      'http://from-file',
    );
  });

  /** The harness's own spelling, which is what people copy out of a compose file. */
  it('accepts FELIX_AUTH_API_KEYS as the key', () => {
    const { config } = resolveConfig([], { FELIX_AUTH_API_KEYS: 'sk-felix-local' }, noFiles);
    expect(config.apiKey).toBe('sk-felix-local');
    expect(authHeaders(config)).toEqual({ authorization: 'Bearer sk-felix-local' });
  });

  it('sends no authorization header at all when nothing is configured', () => {
    // Correct against a harness running FELIX_AUTH_MODE=none.
    expect(authHeaders(resolveConfig([], {}, noFiles).config)).toEqual({});
  });

  it('strips a trailing slash so route building never doubles it', () => {
    expect(resolveConfig(['--origin', 'http://a:8080/'], {}, noFiles).config.origin).toBe(
      'http://a:8080',
    );
  });

  it('takes the leftover words as the first message', () => {
    const { firstMessage } = resolveConfig(['--yes', 'explain', 'this'], {}, noFiles);
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

describe('the checkout .dev.vars', () => {
  const devVars = () => ({ apiKey: 'sk-from-dev-vars', origin: 'http://from-dev-vars' });

  it('supplies the key when nothing narrower does', () => {
    const { config } = resolveConfig([], {}, { userConfig: () => ({}), devVars });
    expect(config.apiKey).toBe('sk-from-dev-vars');
  });

  /**
   * Narrower wins, in the sense of how many runs a source affects: a flag is
   * this run, the environment is this shell, `.dev.vars` is this clone, and the
   * user config is this machine.
   */
  it('loses to the environment and wins over the user config', () => {
    const userConfig = () => ({ apiKey: 'sk-from-user-config' });
    expect(resolveConfig([], {}, { userConfig, devVars }).config.apiKey).toBe('sk-from-dev-vars');
    expect(
      resolveConfig([], { FELIX_API_KEY: 'sk-from-env' }, { userConfig, devVars }).config.apiKey,
    ).toBe('sk-from-env');
    expect(
      resolveConfig(['--key', 'sk-from-flag'], {}, { userConfig, devVars }).config.apiKey,
    ).toBe('sk-from-flag');
  });
});

describe('readDevVars', () => {
  it('is empty when there is no file to read', () => {
    expect(readDevVars(null)).toEqual({});
    expect(readDevVars('/nonexistent/.dev.vars')).toEqual({});
  });

  it('reads the two spellings of the key, and skips comments and blanks', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'felix-dv-')), '.dev.vars');

    writeFileSync(file, '# a comment\n\nFELIX_API_KEY="sk-quoted"\nFELIX_ORIGIN=http://h:9\n');
    expect(readDevVars(file)).toEqual({ apiKey: 'sk-quoted', origin: 'http://h:9' });

    // What `make up` actually writes.
    writeFileSync(file, 'FELIX_AUTH_API_KEYS=sk-harness-spelling\n');
    expect(readDevVars(file)).toEqual({ apiKey: 'sk-harness-spelling' });
  });

  it('ignores everything that is not one of the three names it understands', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'felix-dv-')), '.dev.vars');
    writeFileSync(file, 'CHAT_UI_KEY=not-mine\nDATABASE_URL=postgres://nope\n');
    expect(readDevVars(file)).toEqual({});
  });
});
