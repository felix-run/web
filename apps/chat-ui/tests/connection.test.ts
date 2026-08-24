/** @vitest-environment happy-dom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  isHarnessReachable,
  reportReachability,
  resetReachability,
  subscribe,
} from '../src/lib/connection';

/**
 * The composer has always carried a disconnected state that could not render,
 * because `isConnected` was passed as a literal `true`. This module is what finally
 * sets it, so the behaviour that matters is which outcomes count as unreachable: a
 * transport failure does, an HTTP error does not, because a 500 is still the harness
 * answering.
 */
afterEach(() => {
  resetReachability();
  vi.restoreAllMocks();
});

describe('harness reachability', () => {
  it('starts reachable', () => {
    expect(isHarnessReachable()).toBe(true);
  });

  it('goes unreachable on a transport failure and recovers on any reply', () => {
    reportReachability(false);
    expect(isHarnessReachable()).toBe(false);
    reportReachability(true);
    expect(isHarnessReachable()).toBe(true);
  });

  it('notifies subscribers only when the value actually changes', () => {
    const seen = vi.fn();
    const unsubscribe = subscribe(seen);

    reportReachability(true); // already reachable
    expect(seen).toHaveBeenCalledTimes(0);

    reportReachability(false);
    expect(seen).toHaveBeenCalledTimes(1);

    reportReachability(false); // still unreachable
    expect(seen).toHaveBeenCalledTimes(1);

    unsubscribe();
  });

  it('stops notifying after unsubscribe', () => {
    const seen = vi.fn();
    subscribe(seen)();
    reportReachability(false);
    expect(seen).not.toHaveBeenCalled();
  });

  it('follows the browser going offline and back', () => {
    const unsubscribe = subscribe(() => {});

    window.dispatchEvent(new Event('offline'));
    expect(isHarnessReachable()).toBe(false);

    window.dispatchEvent(new Event('online'));
    expect(isHarnessReachable()).toBe(true);

    unsubscribe();
  });

  it('detaches its window listeners on unsubscribe', () => {
    subscribe(() => {})();
    window.dispatchEvent(new Event('offline'));
    expect(isHarnessReachable()).toBe(true);
  });
});
