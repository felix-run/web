/**
 * Signals for a terminal nobody is looking at.
 *
 * The rest of this client assumes you are watching: state lands in the status
 * line and the transcript, and that is enough. It stops being enough the moment
 * you switch windows — a run can block on an approval minutes later, and a
 * signal that only exists on screen does not exist at all.
 *
 * Two channels, the same split chat-ui's `presence.ts` makes and for the same
 * reason: the window title is always visible in a tab strip, so it reflects the
 * state whether or not you are here; the notification is intrusive, so it fires
 * only when the terminal has told us it lost focus. A terminal that never
 * reports focus at all gets the title and nothing else — "we do not know" is
 * treated as "you might be watching", because the failure of the other choice
 * is a bell every time a run ends under your nose.
 *
 * The focus reports come back as input. Enabling DECSET 1004 makes the terminal
 * send `ESC [ I` and `ESC [ O` on the same stdin Ink is reading, and Ink 7 hands
 * those on to `useInput` as the plain text `[I` and `[O` with no key flags set —
 * so without `isFocusReport` they land in the composer as typed characters every
 * time you tab away. That is why this module owns both halves.
 */

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

/** Terminal focus reporting: DECSET/DECRST 1004, and the two reports it sends. */
const FOCUS_ON = `${ESC}[?1004h`;
const FOCUS_OFF = `${ESC}[?1004l`;
const REPORT_IN = `${ESC}[I`;
const REPORT_OUT = `${ESC}[O`;

/** What Ink makes of those reports by the time they reach `useInput`. */
const INK_IN = '[I';
const INK_OUT = '[O';

/** Push and pop the window title, so the shell's own title survives us. */
const TITLE_PUSH = `${ESC}[22;2t`;
const TITLE_POP = `${ESC}[23;2t`;

/**
 * How long after a real focus report `[I` may still be read as one.
 *
 * `[` and `I` typed quickly enough arrive in a single chunk and are
 * indistinguishable from the report by their text alone. What separates them is
 * that this listener sees the raw bytes first: Ink 7 reads stdin in paused mode
 * (`readable`, then `read()`), and `read()` emits `data` synchronously — so a
 * genuine report has always been recorded by the time the same chunk reaches
 * `useInput` as text, and a burst of typing that happens to spell one has not.
 */
const REPORT_WINDOW_MS = 50;

export type Presence = 'idle' | 'working' | 'blocked';

const BASE_TITLE = 'Felix';

const TITLES: Record<Presence, string> = {
  idle: BASE_TITLE,
  working: `(...) Working - ${BASE_TITLE}`,
  blocked: `(!) Approve - ${BASE_TITLE}`,
};

export interface Attention {
  /** Record what the run is doing. Idempotent, so an effect may drive it. */
  set(next: Presence): void;
  /** True when this `useInput` text is a focus report rather than typing. */
  isFocusReport(input: string): boolean;
  dispose(): void;
}

export interface AttentionOptions {
  stdin: Pick<NodeJS.EventEmitter, 'prependListener' | 'off'>;
  stdout: { write(chunk: string): unknown };
  /** Off entirely: no title, no reporting, no bell. */
  enabled?: boolean;
  now?: () => number;
}

/** A title or a notification body is one line, and never a control sequence. */
function sanitize(text: string, limit = 120): string {
  const flat = text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/** Anything that could terminate the sequence it is being written into. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
const CONTROL = /[\u0000-\u001F\u007F]/g;

export function createAttention(options: AttentionOptions): Attention {
  const { stdin, stdout, enabled = true, now = Date.now } = options;
  let current: Presence = 'idle';
  /** `unknown` until the terminal says otherwise, and it may never say. */
  let focus: 'unknown' | 'focused' | 'blurred' = 'unknown';
  let reportedAt = 0;
  let disposed = false;

  const write = (sequence: string) => {
    if (!enabled || disposed) return;
    try {
      stdout.write(sequence);
    } catch {
      // A terminal that will not take a title will not take a bell either.
    }
  };

  const onData = (chunk: Buffer | string) => {
    const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    // The last report in a chunk wins: a focus-out immediately followed by a
    // focus-in is one net state, not two.
    const out = text.lastIndexOf(REPORT_OUT);
    const inward = text.lastIndexOf(REPORT_IN);
    if (out < 0 && inward < 0) return;
    focus = inward > out ? 'focused' : 'blurred';
    reportedAt = now();
  };

  if (enabled) {
    // Prepended so this stays the first `data` listener whatever else attaches:
    // Ink turns these same bytes into text, and by then it is too late to tell
    // what they were.
    stdin.prependListener('data', onData);
    write(TITLE_PUSH);
    write(FOCUS_ON);
    write(`${ESC}]2;${TITLES.idle}${BEL}`);
  }

  /** OSC 9. Terminals that do not know it consume it; none of them print it. */
  const notify = (body: string) => write(`${ESC}]9;${sanitize(body)}${BEL}`);

  return {
    set(next) {
      if (next === current) return;
      const previous = current;
      current = next;
      write(`${ESC}]2;${TITLES[next]}${BEL}`);

      // Only once the terminal has told us it is not being watched.
      if (focus !== 'blurred') return;
      if (next === 'blocked') notify('Felix: a run is waiting on your decision.');
      else if (next === 'idle' && previous !== 'idle') notify('Felix: the run finished.');
    },
    isFocusReport(input) {
      if (!enabled) return false;
      if (input !== INK_IN && input !== INK_OUT) return false;
      return now() - reportedAt <= REPORT_WINDOW_MS;
    },
    dispose() {
      if (disposed) return;
      if (enabled) {
        write(FOCUS_OFF);
        write(TITLE_POP);
        stdin.off('data', onData);
      }
      disposed = true;
    },
  };
}
