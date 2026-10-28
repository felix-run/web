import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockCopyButton,
  CodeBlockLine,
} from '@felix/ui/code-block';
import { useHighlightedCode } from '@felix/ui/hooks/use-highlighted-code';
import { cn } from '@/lib/utils';

/**
 * `@felix/ui`'s Code Block over `useHighlightedCode`: the one way chat-ui draws a highlighted
 * block (a tool card's JSON, a stored output, a reply's code or a workspace file in the pane).
 * A language the highlighter does not list, or none, draws the same lines unhighlighted, so a
 * caller never has to ask first whether Shiki knows a name. The surface is `bg-code-surface`,
 * the token every other code block here sits on, in both themes: the primitive's own
 * `dark:bg-input/30` would otherwise win in dark, so a caller's surface names `dark:` too.
 */
export function HighlightedCode({
  code,
  language,
  lineNumbers = false,
  wrap = false,
  size = 'sm',
  copyLabel,
  className,
  contentClassName,
}: {
  code: string;
  language: string | null;
  lineNumbers?: boolean;
  wrap?: boolean;
  size?: 'default' | 'sm';
  /** The copy control's accessible name; no control when omitted. */
  copyLabel?: string;
  className?: string;
  contentClassName?: string;
}) {
  const lines = useHighlightedCode(code, language ?? '');
  return (
    <CodeBlock
      size={size}
      data-language={language ?? undefined}
      className={cn('border-border/60 bg-code-surface dark:bg-code-surface', className)}
    >
      {copyLabel && (
        <CodeBlockActions>
          <CodeBlockCopyButton value={code} aria-label={copyLabel} />
        </CodeBlockActions>
      )}
      <CodeBlockContent lineNumbers={lineNumbers} wrap={wrap} className={contentClassName}>
        {lines.map((line, index) => (
          <CodeBlockLine key={index}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  );
}
