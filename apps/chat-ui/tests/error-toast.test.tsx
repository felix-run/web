// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sonner = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('sonner', () => ({ toast: { error: sonner.error } }));

import { toastError, toastProblem } from '../src/lib/error-toast';

/**
 * The contract every failure on this surface is held to.
 *
 * Half the call sites used to print `String(err.message ?? err)` and half ran the
 * error through `describeError`, so what an operator read depended on which
 * control they touched: "The harness failed while trying to continue this run"
 * from one button and `TypeError: Failed to fetch` from the next. These pin the
 * three properties that made that worth centralising, because each one is
 * invisible when it regresses.
 */
function lastCall() {
  const call = sonner.error.mock.calls.at(-1);
  if (!call) throw new Error('no toast was raised');
  return { message: call[0] as string, options: (call[1] ?? {}) as Record<string, unknown> };
}

beforeEach(() => sonner.error.mockClear());

describe('toastError', () => {
  it('translates the error instead of printing it', () => {
    toastError(new Error('chat/continue: 500 upstream exploded'), 'continue this run');

    const { message, options } = lastCall();
    expect(message).toBe(
      'The harness failed while trying to continue this run. This is usually transient, so it is worth retrying.',
    );
    // The raw text is kept, because the status code is what makes a bug report
    // actionable. It is a node so the drag that selects it is not read as a swipe.
    const description = options.description as { props: { children: string } };
    expect(description.props.children).toBe('chat/continue: 500 upstream exploded');
  });

  it('does not dismiss itself', () => {
    toastError(new Error('x: 500'), 'do the thing');
    expect(lastCall().options.duration).toBe(Number.POSITIVE_INFINITY);
  });

  it('offers Retry only when the caller says re-running is safe', () => {
    toastError(new Error('x: 500'), 'do the thing');
    expect(lastCall().options.action).toBeUndefined();

    const again = vi.fn();
    toastError(new Error('x: 500'), 'do the thing', { retry: again });
    const action = lastCall().options.action as { label: string; onClick: () => void };
    expect(action.label).toBe('Retry');
    action.onClick();
    expect(again).toHaveBeenCalledTimes(1);
  });

  it('names an unreachable harness rather than blaming the request', () => {
    toastError(new TypeError('Failed to fetch'), 'rename this conversation');
    expect(lastCall().message).toContain('Could not reach the Felix harness');
  });
});

describe('toastProblem', () => {
  it('reports a failure that never reached the harness, and still persists', () => {
    toastProblem('Microphone access was blocked.');

    const { message, options } = lastCall();
    expect(message).toBe('Microphone access was blocked.');
    expect(options.duration).toBe(Number.POSITIVE_INFINITY);
    expect(options.description).toBeUndefined();
  });
});
