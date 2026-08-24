/** @vitest-environment happy-dom */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ErrorNotice } from '../src/components/error-notice';

/**
 * `ErrorNotice` builds its sentence from a verb phrase the caller supplies. Two of
 * the four sheets used to hardcode one phrase for every failure path, so a failed
 * *activation* — the highest-stakes action in the product — reported "Could not reach
 * the manifest registry", a sentence about a different operation. These pin the two
 * properties that made that possible: that the verb reaches the copy, and that the
 * raw text survives alongside it.
 */

afterEach(cleanup);

describe('ErrorNotice', () => {
  it('names the operation it was given, not a generic one', () => {
    render(<ErrorNotice error={new Error('manifests: 500')} doing="activate v13 of quick" />);
    expect(screen.getByRole('alert').textContent).toContain('activate v13 of quick');
  });

  it('keeps the raw error text for the status code', () => {
    render(<ErrorNotice error={new Error('manifests: 503')} doing="activate v13 of quick" />);
    expect(screen.getByRole('alert').textContent).toContain('manifests: 503');
  });

  it('is a live region, so a failure is announced rather than silent', () => {
    render(<ErrorNotice error={new Error('boom')} doing="do the thing" />);
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('detects an unreachable harness from the TypeError fetch rejects with', () => {
    // This is why the sheets pass the raw error rather than a pre-stringified message.
    render(<ErrorNotice error={new TypeError('Failed to fetch')} doing="list scheduled jobs" />);
    const text = screen.getByRole('alert').textContent ?? '';
    expect(text).toContain('Could not reach the Felix harness');
    expect(text).toContain('list scheduled jobs');
  });

  it('translates an auth rejection into an instruction', () => {
    render(<ErrorNotice error={new Error('manifests: 401')} doing="activate v13 of quick" />);
    expect(screen.getByRole('alert').textContent).toContain('access key was rejected');
  });
});
