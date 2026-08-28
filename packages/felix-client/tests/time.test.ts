import { describe, expect, it } from 'vitest';
import { relativeTime } from '../src/time';

/**
 * This replaced two helpers that disagreed. The thread list handled only the past;
 * the jobs sheet handled both directions but rendered anything under a minute as
 * "0m ago". A scheduled job shows its last run beside its next run, so direction is
 * part of the contract, not a detail.
 */

const NOW = 1_700_000_000_000;
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  it('reads the past as elapsed', () => {
    expect(relativeTime(NOW - 5 * MIN, NOW)).toBe('5m ago');
    expect(relativeTime(NOW - 3 * HOUR, NOW)).toBe('3h ago');
    expect(relativeTime(NOW - 5 * DAY, NOW)).toBe('5d ago');
  });

  it('reads the future as pending, which the thread-list version could not', () => {
    expect(relativeTime(NOW + 5 * MIN, NOW)).toBe('in 5m');
    expect(relativeTime(NOW + 3 * HOUR, NOW)).toBe('in 3h');
    expect(relativeTime(NOW + 5 * DAY, NOW)).toBe('in 5d');
  });

  it('says "just now" rather than "0m ago" under a minute', () => {
    expect(relativeTime(NOW - 1_000, NOW)).toBe('just now');
    expect(relativeTime(NOW, NOW)).toBe('in a moment');
    expect(relativeTime(NOW + 1_000, NOW)).toBe('in a moment');
  });

  it('switches unit at the hour and day boundaries', () => {
    expect(relativeTime(NOW - 59 * MIN, NOW)).toBe('59m ago');
    expect(relativeTime(NOW - HOUR, NOW)).toBe('1h ago');
    expect(relativeTime(NOW - 23 * HOUR, NOW)).toBe('23h ago');
    expect(relativeTime(NOW - DAY, NOW)).toBe('1d ago');
  });
});
