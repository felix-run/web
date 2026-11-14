import type { StackFrame, StackTrace } from '@felix/client';
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceLine,
  TraceTitle,
} from '@felix/ui/trace';

/**
 * A failed command's stack trace (`parseStackTrace` in `@felix/client`), drawn above its
 * streams: the error, then the frames innermost first — the order a person reads a crash in,
 * which CPython prints the other way up. A run of frames in installed packages or the runtime
 * folds into one line, because the frame that matters is nearly always the project's own. The
 * raw streams stay below, untouched; this is a reading of them.
 */
export function StackTraceView({ trace, cwd }: { trace: StackTrace; cwd?: string | undefined }) {
  return (
    <div
      data-slot="stack-trace"
      className="space-y-2 rounded-lg border border-state-failed/30 bg-background p-2.5"
    >
      <p className="font-mono text-xs wrap-anywhere text-state-failed">
        {trace.type && <span className="font-semibold">{trace.type}</span>}
        {trace.type && trace.message ? ': ' : ''}
        {trace.message}
      </p>
      <Trace className="gap-1">
        {groups(trace.frames).map((group) =>
          group.library ? (
            <TraceCollapsible key={`lib-${group.at}`}>
              <TraceCollapsibleTrigger>
                <TraceLine className="text-xs">
                  <TraceTitle>
                    {group.frames.length} {group.frames.length === 1 ? 'frame' : 'frames'} in
                    libraries
                  </TraceTitle>
                </TraceLine>
              </TraceCollapsibleTrigger>
              <TraceCollapsibleContent className="space-y-1">
                {group.frames.map((frame, i) => (
                  <Frame key={i} frame={frame} cwd={cwd} />
                ))}
              </TraceCollapsibleContent>
            </TraceCollapsible>
          ) : (
            group.frames.map((frame, i) => (
              <Frame key={`app-${group.at + i}`} frame={frame} cwd={cwd} />
            ))
          ),
        )}
      </Trace>
    </div>
  );
}

function Frame({ frame, cwd }: { frame: StackFrame; cwd?: string | undefined }) {
  const where = `${relative(frame.file, cwd)}${frame.line === null ? '' : `:${frame.line}`}`;
  return (
    // A column: `Trace` makes any child holding a line a flex row, which put the source
    // line beside its frame rather than under it.
    <div className="min-w-0 flex-col">
      <TraceLine className="text-xs">
        <TraceTitle className="font-mono text-foreground">{frame.fn ?? '<module>'}</TraceTitle>
        <TraceDescription
          className="min-w-0 truncate font-mono text-muted-foreground"
          title={where}
        >
          {where}
        </TraceDescription>
      </TraceLine>
      {frame.source && (
        <p className="mt-0.5 ml-3 truncate font-mono text-xs text-muted-foreground">
          {frame.source}
        </p>
      )}
    </div>
  );
}

/** Consecutive frames split into the project's own and runs of library frames. */
function groups(frames: StackFrame[]): { library: boolean; at: number; frames: StackFrame[] }[] {
  const out: { library: boolean; at: number; frames: StackFrame[] }[] = [];
  frames.forEach((frame, at) => {
    const last = out[out.length - 1];
    if (last && last.library === frame.library) last.frames.push(frame);
    else out.push({ library: frame.library, at, frames: [frame] });
  });
  return out;
}

/** A path inside the command's working directory, written relative to it. */
function relative(file: string, cwd: string | undefined): string {
  if (!cwd) return file;
  const base = cwd.endsWith('/') ? cwd : `${cwd}/`;
  return file.startsWith(base) ? file.slice(base.length) : file;
}
