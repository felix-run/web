import { describe, expect, it } from 'vitest';
import { nextAfter, parseSchedule, ScheduleError, scheduleLabel } from '../src/lib/job-schedule';

/**
 * The harness's schedule grammar (`felix/jobs/schedule.py`), held to its semantics: an empty
 * schedule is manual only (`felix-run/felix#629`), and the client reads every other form the
 * way the harness does, and refuses what it refuses.
 */
const at = (iso: string) => Date.parse(iso);

describe('parseSchedule', () => {
  it('reads an empty schedule as manual only, as the harness does', () => {
    expect(parseSchedule('')).toEqual({ kind: 'manual' });
    expect(parseSchedule('   ')).toEqual({ kind: 'manual' });
  });

  it('reads seconds and intervals', () => {
    expect(parseSchedule('300')).toEqual({ kind: 'interval', ms: 300_000 });
    expect(parseSchedule('0')).toEqual({ kind: 'interval', ms: 1_000 });
    expect(parseSchedule('every:30s')).toEqual({ kind: 'interval', ms: 30_000 });
    expect(parseSchedule('every:5m')).toEqual({ kind: 'interval', ms: 300_000 });
    expect(parseSchedule('@every 2h')).toEqual({ kind: 'interval', ms: 7_200_000 });
  });

  it('refuses what the harness refuses', () => {
    expect(() => parseSchedule('0 9 * *')).toThrow(ScheduleError);
    expect(() => parseSchedule('61 * * * *')).toThrow(/minute field/);
    expect(() => parseSchedule('0 0 30 2 *')).toThrow(/never fires/);
    expect(() => parseSchedule('every:5d')).toThrow(ScheduleError);
  });
});

describe('nextAfter', () => {
  it('fires a daily cron at its next minute, in UTC', () => {
    const s = parseSchedule('0 9 * * *');
    expect(nextAfter(s, at('2026-10-12T14:00:00Z'))).toBe(at('2026-10-13T09:00:00Z'));
    expect(nextAfter(s, at('2026-10-12T08:59:30Z'))).toBe(at('2026-10-12T09:00:00Z'));
  });

  it('expands macros and steps', () => {
    expect(nextAfter(parseSchedule('@hourly'), at('2026-10-12T14:20:00Z'))).toBe(
      at('2026-10-12T15:00:00Z'),
    );
    expect(nextAfter(parseSchedule('*/15 * * * *'), at('2026-10-12T14:20:00Z'))).toBe(
      at('2026-10-12T14:30:00Z'),
    );
  });

  it('applies Vixie’s either-day rule only when both day fields are restricted', () => {
    // 2026-10-12 is a Monday. Day 15 or a Sunday: the Sunday (18th) is not before the 15th.
    expect(nextAfter(parseSchedule('0 0 15 * 0'), at('2026-10-12T12:00:00Z'))).toBe(
      at('2026-10-15T00:00:00Z'),
    );
    // `*/2` is unrestricted: odd days that are also Sundays, so the 25th.
    expect(nextAfter(parseSchedule('0 0 */2 * 0'), at('2026-10-12T12:00:00Z'))).toBe(
      at('2026-10-25T00:00:00Z'),
    );
  });

  it('adds an interval to the start', () => {
    expect(nextAfter(parseSchedule('every:1m'), 1_000)).toBe(61_000);
  });

  it('gives a manual-only schedule no next firing', () => {
    expect(nextAfter(parseSchedule(''), 1_000)).toBeNull();
  });
});

describe('scheduleLabel', () => {
  it('says manual for an empty schedule, and an interval as one', () => {
    expect(scheduleLabel('')).toBe('manual');
    expect(scheduleLabel('300')).toBe('every 5m');
    expect(scheduleLabel('every:90s')).toBe('every 90s');
    expect(scheduleLabel('every:2h')).toBe('every 2h');
  });

  it('quotes a cron or macro back as stored', () => {
    expect(scheduleLabel('0 9 * * *')).toBe('0 9 * * *');
    expect(scheduleLabel('@daily')).toBe('@daily');
  });
});

describe('a one-shot', () => {
  const at = 'at:2026-10-21T09:00:00Z';

  it('reads as the moment it names, which an agent scheduling a task stores', () => {
    expect(parseSchedule(at)).toEqual({ kind: 'once', at: Date.UTC(2026, 9, 21, 9) });
    expect(parseSchedule('at:2026-10-21T05:00:00-04:00')).toEqual({
      kind: 'once',
      at: Date.UTC(2026, 9, 21, 9),
    });
  });

  it('refuses a moment with no offset, as the harness does', () => {
    expect(() => parseSchedule('at:2026-10-21T09:00:00')).toThrow(ScheduleError);
  });

  it('fires once: nothing comes after its moment', () => {
    const once = parseSchedule(at);
    expect(nextAfter(once, Date.UTC(2026, 9, 21, 8))).toBe(Date.UTC(2026, 9, 21, 9));
    expect(nextAfter(once, Date.UTC(2026, 9, 21, 10))).toBeNull();
  });

  it('is labelled as one rather than quoted', () => {
    expect(scheduleLabel(at)).toMatch(/^once · /);
  });
});
