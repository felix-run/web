// @vitest-environment happy-dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSpeechRecognition } from '../src/hooks/use-speech-recognition';

/**
 * Voice input, and the identity of the callback it is given.
 *
 * The composer builds `onFinalTranscript` from `controller.textInput`, which the
 * prompt-input provider rebuilds whenever the text changes — so the callback is
 * a new function on every keystroke. When `start` listed it as a dependency,
 * `start` churned with it, and so did everything memoised on `start`. That is
 * the same shape as the composer's update loop: per-keystroke work for no
 * reason, invisible until something counts it.
 *
 * Holding the callback in a ref fixes that, and the fix is only correct if the
 * *latest* callback still fires — a ref that goes stale would trade a
 * performance bug for a correctness one, which is the trap in this pattern.
 */

/** A recognition object the test can drive, standing in for the browser's. */
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  continuous = false;
  interimResults = false;
  lang = '';
  onresult: ((event: unknown) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;

  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {}
  stop() {
    this.onend?.();
  }

  /** Deliver one finalised utterance, the way the browser would. */
  say(transcript: string) {
    this.onresult?.({
      resultIndex: 0,
      results: [{ isFinal: true, 0: { transcript } }],
    });
  }
}

beforeEach(() => {
  FakeRecognition.instances = [];
  vi.stubGlobal('SpeechRecognition', FakeRecognition);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useSpeechRecognition', () => {
  it('keeps `start` stable when only the callback identity changes', () => {
    const { result, rerender } = renderHook(
      ({ onFinalTranscript }: { onFinalTranscript: (t: string) => void }) =>
        useSpeechRecognition({ onFinalTranscript }),
      { initialProps: { onFinalTranscript: () => {} } },
    );

    const first = result.current.start;
    // A new function every render is exactly what the composer passes.
    rerender({ onFinalTranscript: () => {} });
    rerender({ onFinalTranscript: () => {} });

    expect(result.current.start).toBe(first);
  });

  it('still calls the newest callback, not the one that opened the session', () => {
    const early = vi.fn();
    const late = vi.fn();
    const { result, rerender } = renderHook(
      ({ onFinalTranscript }: { onFinalTranscript: (t: string) => void }) =>
        useSpeechRecognition({ onFinalTranscript }),
      { initialProps: { onFinalTranscript: early } },
    );

    act(() => result.current.start());
    // The session is open, and *then* the composer re-renders with a new one.
    rerender({ onFinalTranscript: late });
    act(() => FakeRecognition.instances[0]?.say('hello there'));

    expect(late).toHaveBeenCalledWith('hello there');
    expect(early).not.toHaveBeenCalled();
  });

  it('rebuilds `start` when the language actually changes', () => {
    const { result, rerender } = renderHook(
      ({ lang }: { lang: string }) => useSpeechRecognition({ onFinalTranscript: () => {}, lang }),
      { initialProps: { lang: 'en-US' } },
    );

    const first = result.current.start;
    rerender({ lang: 'fr-FR' });

    expect(result.current.start).not.toBe(first);
  });
});
