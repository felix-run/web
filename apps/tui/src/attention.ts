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
 * **The renderer owns the focus reports now.** They arrive as bytes on stdin,
 * and this module used to have to intercept them before the UI layer turned
 * them into typed text — that is what `isFocusReport` was, and it is gone. The
 * renderer parses the two reports itself and emits `focus` / `blur`, so
 * `setFocus` is all that is left of that half: `app.tsx` subscribes and calls
 * it.
 *
 * `begin` still *asks* for reporting, because parsing a report and requesting
 * one are different jobs and the renderer only reliably does the first — under
 * a terminal that never answers its capability query it asks for nothing. The
 * request is still made from inside the render rather than around it: until the
 * terminal is in raw mode it **echoes** the reply, and a literal `^[[I` printed
 * into the first frame stays there for the life of the session.
 */

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

/** Terminal focus reporting: DECSET/DECRST 1004. */
const FOCUS_ON = `${ESC}[?1004h`;
const FOCUS_OFF = `${ESC}[?1004l`;

/** Push and pop the window title, so the shell's own title survives us. */
const TITLE_PUSH = `${ESC}[22;2t`;
const TITLE_POP = `${ESC}[23;2t`;

export type Presence = 'idle' | 'working' | 'blocked';

const BASE_TITLE = 'Felix';

const TITLES: Record<Presence, string> = {
  idle: BASE_TITLE,
  working: `(...) Working - ${BASE_TITLE}`,
  blocked: `(!) Approve - ${BASE_TITLE}`,
};

export interface Attention {
  /**
   * Start asking the terminal about focus. Call once the renderer has raw mode
   * on — before that the tty echoes the answer onto the screen.
   */
  begin(): void;
  /** Stop asking, while the renderer still owns the terminal. */
  end(): void;
  /** Record what the run is doing. Idempotent, so an effect may drive it. */
  set(next: Presence): void;
  /** Told by the renderer's `focus` / `blur` events. Never inferred. */
  setFocus(focused: boolean): void;
  dispose(): void;
}

export interface AttentionOptions {
  stdout: { write(chunk: string): unknown };
  /** Off entirely: no title, no reporting, no bell. */
  enabled?: boolean;
}

/** Anything that could terminate the sequence it is being written into. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: removing them is the point
const CONTROL = /[\u0000-\u001F\u007F]/g;

/** A title or a notification body is one line, and never a control sequence. */
function sanitize(text: string, limit = 120): string {
  const flat = text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

export function createAttention(options: AttentionOptions): Attention {
  const { stdout, enabled = true } = options;
  let current: Presence = 'idle';
  /** `unknown` until the terminal says otherwise, and it may never say. */
  let focus: 'unknown' | 'focused' | 'blurred' = 'unknown';
  let started = false;
  let disposed = false;

  const write = (sequence: string) => {
    if (!enabled || disposed) return;
    try {
      stdout.write(sequence);
    } catch {
      // A terminal that will not take a title will not take a bell either.
    }
  };

  /** OSC 9. Terminals that do not know it consume it; none of them print it. */
  const notify = (body: string) => write(`${ESC}]9;${sanitize(body)}${BEL}`);

  return {
    begin() {
      if (!enabled || started || disposed) return;
      started = true;
      write(TITLE_PUSH);
      write(FOCUS_ON);
      write(`${ESC}]2;${TITLES[current]}${BEL}`);
    },
    end() {
      if (!started) return;
      started = false;
      write(FOCUS_OFF);
      write(TITLE_POP);
    },
    set(next) {
      if (next === current) return;
      const previous = current;
      current = next;
      // Before `begin`, the terminal is not ours to write to.
      if (started) write(`${ESC}]2;${TITLES[next]}${BEL}`);

      // Only once the terminal has told us it is not being watched.
      if (focus !== 'blurred') return;
      if (next === 'blocked') notify('Felix: a run is waiting on your decision.');
      else if (next === 'idle' && previous !== 'idle') notify('Felix: the run finished.');
    },
    setFocus(focused) {
      focus = focused ? 'focused' : 'blurred';
    },
    dispose() {
      if (disposed) return;
      if (started) {
        // Normally `end` has already run from the component that started it;
        // this is the path where the process is going down another way.
        started = false;
        write(FOCUS_OFF);
        write(TITLE_POP);
      }
      disposed = true;
    },
  };
}
