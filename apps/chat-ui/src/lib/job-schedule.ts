/**
 * A job's `schedule`, read the way the harness reads it (`felix/jobs/schedule.py`).
 *
 * The page used to say an empty schedule was "manual" and "never runs on its own". The harness
 * runs it every 60 seconds — the default an unscheduled job has always had — so a job labelled
 * manual fired about 1,440 times a day while the page said it was idle. This is the grammar the
 * harness accepts, ported field for field, so the badge, the form's preview of the next firing
 * and its validation all say what the harness will actually do. It refuses what the harness
 * refuses rather than guessing, as the harness does.
 */

export const DEFAULT_INTERVAL_MS = 60_000;

/** What the harness says when a schedule is outside its grammar. */
export const SCHEDULE_GRAMMAR =
  'expected seconds, every:<n><s|m|h>, @hourly/@daily/@weekly/@monthly/@yearly, or a five-field cron expression';

export class ScheduleError extends Error {}

const INTERVAL = /^@?every[:\s]+(\d+)\s*([smh])$/;
const UNIT_MS = { s: 1_000, m: 60_000, h: 3_600_000 } as const;
const MACROS: Record<string, string> = {
  '@hourly': '0 * * * *',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@weekly': '0 0 * * 0',
  '@monthly': '0 0 1 * *',
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
};
const BOUNDS: readonly (readonly [number, number])[] = [
  [0, 59],
  [0, 23],
  [1, 31],
  [1, 12],
  [0, 7],
];
const FIELD_NAMES = ['minute', 'hour', 'day-of-month', 'month', 'day-of-week'] as const;
/** As the harness: long enough to reach the next 29 February across a skipped leap century. */
const SEARCH_DAYS = 366 * 9;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

interface Cron {
  minutes: Set<number>;
  hours: Set<number>;
  days: Set<number>;
  months: Set<number>;
  weekdays: Set<number>;
  daysRestricted: boolean;
  weekdaysRestricted: boolean;
}

export type Schedule = { kind: 'interval'; ms: number } | { kind: 'cron'; cron: Cron };

function dayMatches(c: Cron, d: Date): boolean {
  const inDays = c.days.has(d.getUTCDate());
  const inWeekdays = c.weekdays.has(d.getUTCDay());
  // Vixie's rule: both restricted means either matches.
  if (c.daysRestricted && c.weekdaysRestricted) return inDays || inWeekdays;
  return inDays && inWeekdays;
}

function cronNextAfter(c: Cron, fromMs: number): number | null {
  let t = Math.floor(fromMs / MINUTE) * MINUTE + MINUTE;
  const end = t + SEARCH_DAYS * DAY;
  while (t < end) {
    const d = new Date(t);
    if (!c.months.has(d.getUTCMonth() + 1) || !dayMatches(c, d)) {
      t = Math.floor(t / DAY) * DAY + DAY;
      continue;
    }
    if (!c.hours.has(d.getUTCHours())) {
      t = Math.floor(t / HOUR) * HOUR + HOUR;
      continue;
    }
    if (!c.minutes.has(d.getUTCMinutes())) {
      t += MINUTE;
      continue;
    }
    return t;
  }
  return null;
}

function parseField(text: string, index: number): Set<number> {
  const [low, high] = BOUNDS[index] as readonly [number, number];
  const name = FIELD_NAMES[index];
  const values = new Set<number>();
  for (const part of text.split(',')) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
    if (!m) throw new ScheduleError(`Cannot read the ${name} field; ${SCHEDULE_GRAMMAR}.`);
    const span = m[1] as string;
    const stepText = m[2];
    let start: number;
    let stop: number;
    if (span === '*') {
      start = low;
      stop = high;
    } else if (span.includes('-')) {
      const [a, b] = span.split('-');
      start = Number(a);
      stop = Number(b);
    } else {
      start = Number(span);
      // `5/15` means "from 5, every 15", as in Vixie cron.
      stop = stepText ? high : start;
    }
    const step = stepText ? Number(stepText) : 1;
    if (!(low <= start && start <= stop && stop <= high) || step < 1) {
      throw new ScheduleError(`The ${name} field must stay within ${low}-${high}.`);
    }
    for (let v = start; v <= stop; v += step) values.add(v);
  }
  return values;
}

function parseCron(text: string): Cron {
  const fields = text.split(/\s+/).filter(Boolean);
  if (fields.length !== 5) throw new ScheduleError(`Not a schedule: ${SCHEDULE_GRAMMAR}.`);
  const [minutes, hours, days, months, weekdays] = fields.map((f, i) => parseField(f, i)) as [
    Set<number>,
    Set<number>,
    Set<number>,
    Set<number>,
    Set<number>,
  ];
  const cron: Cron = {
    minutes,
    hours,
    days,
    months,
    weekdays: new Set([...weekdays].map((d) => d % 7)),
    daysRestricted: !(fields[2] as string).startsWith('*'),
    weekdaysRestricted: !(fields[4] as string).startsWith('*'),
  };
  if (cronNextAfter(cron, 0) === null) {
    throw new ScheduleError('This cron expression never fires.');
  }
  return cron;
}

/** Parse as the harness does; throws `ScheduleError` for anything it would refuse. */
export function parseSchedule(schedule: string): Schedule {
  const s = (schedule ?? '').trim().toLowerCase();
  if (!s) return { kind: 'interval', ms: DEFAULT_INTERVAL_MS };
  if (/^\d+$/.test(s)) return { kind: 'interval', ms: Math.max(Number(s), 1) * 1_000 };
  const m = INTERVAL.exec(s);
  if (m) {
    return {
      kind: 'interval',
      ms: Math.max(Number(m[1]), 1) * UNIT_MS[m[2] as keyof typeof UNIT_MS],
    };
  }
  return { kind: 'cron', cron: parseCron(MACROS[s] ?? s) };
}

/** When a parsed schedule next fires after `fromMs`. */
export function nextAfter(schedule: Schedule, fromMs: number): number {
  if (schedule.kind === 'interval') return fromMs + schedule.ms;
  // Unreachable for a cron that passed `parseCron`, which refuses one that never fires.
  return cronNextAfter(schedule.cron, fromMs) ?? Number.NaN;
}

function intervalText(ms: number): string {
  if (ms % HOUR === 0) return `${ms / HOUR}h`;
  if (ms % MINUTE === 0) return `${ms / MINUTE}m`;
  return `${Math.round(ms / 1_000)}s`;
}

/**
 * The schedule as a row's badge says it. An interval is said as one (`every 1m`) — the empty
 * schedule above all, which is what the old `manual` stood for. A macro or cron is the
 * harness's own text, quoted back; anything the harness would not parse is quoted too, since
 * the row should show what is stored rather than a guess at what was meant.
 */
export function scheduleLabel(schedule: string): string {
  try {
    const parsed = parseSchedule(schedule);
    if (parsed.kind === 'interval') return `every ${intervalText(parsed.ms)}`;
  } catch {
    // Fall through: quote what is stored.
  }
  return schedule.trim();
}
