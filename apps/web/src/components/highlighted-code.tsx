import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
} from '@felix/ui/code-block';
import { useHighlightedCode } from '@felix/ui/hooks/use-highlighted-code';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// biome-ignore lint/suspicious/noControlCharactersInRegex: an ANSI escape starts with ESC
const ANSI_CODES = /\u001b\[[0-9;?]*[A-Za-z]/g;

/** Terminal output with its colour codes taken out: what it reads as, and what a copy should hold. */
export function stripAnsi(text: string): string {
  return text.replace(ANSI_CODES, '');
}

/**
 * `@felix/ui`'s Code Block over `useHighlightedCode`: the one way chat-ui draws a highlighted
 * block (a tool card's JSON, a stored output, a shell command's streams, a reply's code or a
 * workspace file in the pane). A language the highlighter does not list, or none, draws the
 * same lines unhighlighted, so a caller never has to ask first whether Shiki knows a name. The
 * surface is `bg-code-surface`, the token every other code block here sits on, in both themes:
 * the primitive's own `dark:bg-input/30` would otherwise win in dark, so a caller's surface
 * names `dark:` too.
 *
 * `ansi` is terminal output: Shiki draws its colour codes as colour, and until the highlighter
 * has loaded the lines are shown with the codes taken out rather than printed.
 */
export function HighlightedCode({
  code,
  language,
  title,
  lineNumbers = false,
  wrap = false,
  size = 'sm',
  copyLabel,
  copyText,
  className,
  contentClassName,
}: {
  code: string;
  language: string | null;
  /** A header line above the code; the copy control moves into it. */
  title?: ReactNode;
  lineNumbers?: boolean;
  wrap?: boolean;
  size?: 'default' | 'sm';
  /** The copy control's accessible name; no control when omitted. */
  copyLabel?: string;
  /** What the copy control copies, when it is not `code` itself. */
  copyText?: string;
  className?: string;
  contentClassName?: string;
}) {
  const ansi = language === 'ansi';
  const lines = useHighlightedCode(code, language ?? '');
  const copy = copyLabel && (
    <CodeBlockCopyButton
      value={copyText ?? (ansi ? stripAnsi(code) : code)}
      aria-label={copyLabel}
    />
  );
  return (
    <CodeBlock
      size={size}
      data-language={language ?? undefined}
      className={cn('border-border/60 bg-code-surface dark:bg-code-surface', className)}
    >
      {title ? (
        <CodeBlockHeader>
          <CodeBlockTitle className="font-mono font-normal text-muted-foreground">
            {title}
          </CodeBlockTitle>
          {copy && <CodeBlockActions>{copy}</CodeBlockActions>}
        </CodeBlockHeader>
      ) : (
        copy && <CodeBlockActions>{copy}</CodeBlockActions>
      )}
      <CodeBlockContent lineNumbers={lineNumbers} wrap={wrap} className={contentClassName}>
        {lines.map((line, index) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: a line's position is its identity
          <CodeBlockLine key={index}>
            {ansi && typeof line === 'string' ? stripAnsi(line) : line}
          </CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}
