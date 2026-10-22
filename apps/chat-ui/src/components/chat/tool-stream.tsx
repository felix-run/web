import {
  Terminal,
  TerminalActions,
  TerminalContent,
  TerminalCopyButton,
  TerminalHeader,
  TerminalTitle,
} from '@/components/ai-elements/terminal';

/**
 * One stream of a shell command's output, as a terminal: commands colour their output with
 * ANSI codes, and a <pre> printed them as `\u001b[32m` noise around the words. The surface
 * is the code slab, not the vendored near-black, so it sits in both themes like every other
 * block of tool output.
 *
 * Its own module because it is loaded lazily (`tool.tsx`): the ANSI parser and the link
 * finder it brings were in every first load, for output only a shell call produces.
 */
export function TerminalStream({ label, text }: { label: string; text: string }) {
  return (
    <Terminal
      output={text}
      autoScroll={false}
      className="border-border/60 bg-code-surface text-foreground"
    >
      <TerminalHeader className="border-border/60 px-2.5 py-1">
        <TerminalTitle className="text-xs text-muted-foreground [&>svg]:size-3.5">
          {label}
        </TerminalTitle>
        <TerminalActions>
          <TerminalCopyButton aria-label={`Copy ${label}`} className="size-6" />
        </TerminalActions>
      </TerminalHeader>
      <TerminalContent className="max-h-64 p-2.5 text-xs" />
    </Terminal>
  );
}
