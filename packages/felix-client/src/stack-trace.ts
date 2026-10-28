/**
 * A stack trace in a command's output, read conservatively like every other shape here: a miss
 * leaves the stream as the text it was, and a false positive would dress ordinary output up as
 * a crash. Two dialects, the two a workspace's commands actually print: CPython's traceback and
 * V8's (`node`, `vitest`, `tsx`). The harness's own tool errors are `[tool error/<code>] …` with
 * no frames, so this reads shell output only.
 */

export interface StackFrame {
  /** The function, or null where the runtime did not name one. */
  fn: string | null;
  file: string;
  line: number | null;
  column: number | null;
  /** The source line CPython prints under a frame, when it did. */
  source: string | null;
  /** A frame in an installed package or the runtime rather than the project's own code. */
  library: boolean;
}

export interface StackTrace {
  runtime: 'python' | 'node';
  /** The exception's type, `ValueError` / `TypeError`, when one is named. */
  type: string | null;
  message: string;
  /** Innermost first: the frame that raised, then its callers. */
  frames: StackFrame[];
}

const LIBRARY =
  /(^|[/\\])(site-packages|dist-packages|node_modules)[/\\]|^node:|^internal[/\\]|^<frozen |(^|[/\\])lib[/\\]python\d/;

const isLibrary = (file: string) => LIBRARY.test(file);

const PY_HEAD = 'Traceback (most recent call last):';
const PY_FRAME = /^ {2}File "(.+)", line (\d+)(?:, in (.+))?$/;
const PY_ERROR =
  /^([A-Za-z_][\w.]*(?:Error|Exception|Exit|Interrupt|Warning|Iteration))(?:: (.*))?$/;

function parsePython(lines: string[]): StackTrace | null {
  // The last traceback in the text: a chained exception prints its cause first, and the one
  // that ended the command is the one at the bottom.
  const start = lines.lastIndexOf(PY_HEAD);
  if (start === -1) return null;
  const frames: StackFrame[] = [];
  let i = start + 1;
  for (; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const m = PY_FRAME.exec(line);
    if (m) {
      const file = m[1] ?? '';
      frames.push({
        fn: m[3] && m[3] !== '<module>' ? m[3] : null,
        file,
        line: Number(m[2]),
        column: null,
        source: null,
        library: isLibrary(file),
      });
      continue;
    }
    // A frame's source line, and the caret lines 3.11+ draw under it, are indented further.
    if (line.startsWith('    ')) {
      const last = frames[frames.length - 1];
      const text = line.trim();
      if (last && last.source === null && !/^[\^~\s]+$/.test(text)) last.source = text;
      continue;
    }
    break;
  }
  const err = PY_ERROR.exec((lines[i] ?? '').trim());
  if (!frames.length || !err) return null;
  return {
    runtime: 'python',
    type: err[1] ?? null,
    message: (err[2] ?? '').trim(),
    frames: frames.reverse(),
  };
}

const V8_ERROR = /^(?:Uncaught )?([A-Za-z_$][\w$.]*(?:Error|Exception))(?:: (.*))?$/;
// `    at fn (file:line:col)`, `    at file:line:col`, `    at async fn (file:line:col)`.
const V8_FRAME = /^\s+at (?:async )?(?:(.+?) \((.+?):(\d+):(\d+)\)|(.+?):(\d+):(\d+))$/;
// Any `at` line, including the ones with no location (`at Array.map (<anonymous>)`): they are
// part of the stack and must not end it, though they draw no frame.
const V8_LINE = /^\s+at \S/;

function parseNode(lines: string[]): StackTrace | null {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!V8_LINE.test(lines[i] ?? '')) continue;
    // The bottom of a stack; walk up to its first line and the error line above it.
    let top = i;
    while (top > 0 && V8_LINE.test(lines[top - 1] ?? '')) top--;
    const err = V8_ERROR.exec((lines[top - 1] ?? '').trim());
    const frames: StackFrame[] = [];
    for (let j = top; j <= i; j++) {
      const m = V8_FRAME.exec(lines[j] ?? '');
      if (!m) continue;
      const file = (m[2] ?? m[5] ?? '').replace(/^file:\/\//, '');
      frames.push({
        fn: m[1] ?? null,
        file,
        line: Number(m[3] ?? m[6]),
        column: Number(m[4] ?? m[7]),
        source: null,
        library: isLibrary(file),
      });
    }
    // Two frames at least: one `at` line under an error is how a lot of ordinary log
    // output looks, and is not worth a trace view.
    if (!err || frames.length < 2) return null;
    return { runtime: 'node', type: err[1] ?? null, message: (err[2] ?? '').trim(), frames };
  }
  return null;
}

/** The stack trace that ended a command's output, or null when there is none. */
export function parseStackTrace(text: unknown): StackTrace | null {
  if (typeof text !== 'string' || !text) return null;
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  return parsePython(lines) ?? parseNode(lines);
}
