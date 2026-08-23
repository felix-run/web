import { describe, expect, it } from 'vitest';
import { type ComposerKey, composerKeyAction } from '../src/lib/composer';

const key = (over: Partial<ComposerKey> = {}): ComposerKey => ({
  key: 'Enter',
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  isComposing: false,
  ...over,
});

const idle = { streaming: false, hasText: true };
const running = { streaming: true, hasText: true };

describe('composerKeyAction', () => {
  it('sends on plain Enter when idle', () => {
    expect(composerKeyAction(key(), idle)).toBe('run');
  });

  it('inserts a newline on Shift+Enter, running or not', () => {
    expect(composerKeyAction(key({ shiftKey: true }), idle)).toBe('newline');
    expect(composerKeyAction(key({ shiftKey: true }), running)).toBe('newline');
  });

  it('leaves every non-Enter key to the browser', () => {
    expect(composerKeyAction(key({ key: 'a' }), idle)).toBe('newline');
    expect(composerKeyAction(key({ key: 'Escape' }), running)).toBe('newline');
  });

  // The composer used to be disabled for the whole run, so Steer — which only
  // exists during a run — could never be reached with text in the box.
  it('queues on Enter and steers on Cmd/Ctrl+Enter while a turn runs', () => {
    expect(composerKeyAction(key(), running)).toBe('follow_up');
    expect(composerKeyAction(key({ metaKey: true }), running)).toBe('steer');
    expect(composerKeyAction(key({ ctrlKey: true }), running)).toBe('steer');
  });

  it('treats Cmd/Ctrl+Enter as an ordinary send when nothing is running', () => {
    expect(composerKeyAction(key({ metaKey: true }), idle)).toBe('run');
  });

  // An IME fires Enter to commit a candidate; acting on it posts a half-typed
  // word and destroys the composition.
  it('never acts on an Enter that is closing an IME candidate window', () => {
    expect(composerKeyAction(key({ isComposing: true }), idle)).toBe('newline');
    expect(composerKeyAction(key({ isComposing: true, metaKey: true }), running)).toBe('newline');
  });

  it('swallows Enter when there is nothing to send', () => {
    expect(composerKeyAction(key(), { streaming: false, hasText: false })).toBe('ignore');
    expect(composerKeyAction(key({ metaKey: true }), { streaming: true, hasText: false })).toBe(
      'ignore',
    );
  });
});
