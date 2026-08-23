import { findFileMentions } from '@felix/cowork-client';
import { createContext, Fragment, type ReactNode, useContext, useMemo } from 'react';
import { Streamdown } from 'streamdown';
import type { ResolvedMentions } from '@/lib/mentions';
import { cn } from '@/lib/utils';

/**
 * Fenced code is full of paths that are examples, not references, so mentions
 * inside it stay plain. The renderer hands inline and fenced code to the same
 * `code` component, so the only thing that separates them is which one sits
 * inside a `pre` — hence a context set there rather than a check on the node.
 */
const InsideCodeBlock = createContext(false);

/** Prose containers whose text may name a file. */
const TEXT_TAGS = ['p', 'li', 'td', 'th', 'strong', 'em', 'blockquote'] as const;

/**
 * Replace confirmed mentions inside a rendered text run with buttons.
 *
 * Only strings are touched. Nested elements are left exactly as the renderer
 * produced them and get linkified by their own component override, so nothing
 * is walked twice and no markup is reconstructed.
 */
function linkify(
  children: ReactNode,
  mentions: ResolvedMentions,
  onOpen: (path: string, line?: number) => void,
): ReactNode {
  if (mentions.size === 0) return children;

  if (Array.isArray(children)) {
    return children.map((child, i) => (
      // biome-ignore lint/suspicious/noArrayIndexKey: rendered output, positionally stable
      <Fragment key={i}>{linkify(child, mentions, onOpen)}</Fragment>
    ));
  }
  if (typeof children !== 'string') return children;

  const found = findFileMentions(children).filter((m) => mentions.has(m.path));
  if (found.length === 0) return children;

  const out: ReactNode[] = [];
  let cursor = 0;
  found.forEach((mention, i) => {
    if (mention.start > cursor) out.push(children.slice(cursor, mention.start));
    const target = mentions.get(mention.path);
    out.push(
      <button
        // biome-ignore lint/suspicious/noArrayIndexKey: rendered output, positionally stable
        key={i}
        type="button"
        className="rounded-sm font-mono text-[0.95em] text-primary underline decoration-dotted underline-offset-2 hover:decoration-solid"
        title={target}
        onClick={() => target && onOpen(target, mention.line)}
      >
        {mention.raw}
      </button>,
    );
    cursor = mention.end;
  });
  if (cursor < children.length) out.push(children.slice(cursor));
  return out;
}

export interface ResponseProps {
  children: string;
  className?: string;
  /** Confirmed mentions for this message; empty until the workspace answers. */
  mentions?: ResolvedMentions;
  onOpenFile?: (path: string, line?: number) => void;
}

const NO_MENTIONS: ResolvedMentions = new Map();

/**
 * Streamed assistant markdown. Tolerates unclosed fences mid-stream.
 *
 * File names the workspace has confirmed become buttons. Nothing is decorated
 * optimistically — an unconfirmed name stays plain text, so the transcript never
 * offers a link that leads nowhere.
 */
export function Response({
  children,
  className,
  mentions = NO_MENTIONS,
  onOpenFile,
}: ResponseProps) {
  const components = useMemo(() => {
    if (mentions.size === 0 || !onOpenFile) return undefined;

    const wrap = (Tag: (typeof TEXT_TAGS)[number]) =>
      function Linkified({ children: kids, ...rest }: { children?: ReactNode }) {
        return <Tag {...rest}>{linkify(kids, mentions, onOpenFile)}</Tag>;
      };

    return {
      ...Object.fromEntries(TEXT_TAGS.map((tag) => [tag, wrap(tag)])),
      pre: function Pre({ children: kids, ...rest }: { children?: ReactNode }) {
        return (
          <InsideCodeBlock.Provider value={true}>
            <pre {...rest}>{kids}</pre>
          </InsideCodeBlock.Provider>
        );
      },
      code: function Code({ children: kids, ...rest }: { children?: ReactNode }) {
        const fenced = useContext(InsideCodeBlock);
        return <code {...rest}>{fenced ? kids : linkify(kids, mentions, onOpenFile)}</code>;
      },
    };
  }, [mentions, onOpenFile]);

  return (
    <Streamdown className={cn('max-w-none break-words text-sm', className)} components={components}>
      {children}
    </Streamdown>
  );
}
