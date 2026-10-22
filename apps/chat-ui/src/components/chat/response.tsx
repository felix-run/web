import { PanelRightOpenIcon } from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import remarkBreaks from 'remark-breaks';
import { defaultRemarkPlugins, Streamdown, type StreamdownProps } from 'streamdown';
import { loadedPlugins, loadPlugins, needsMath, needsRaw, pluginsFor } from '@/lib/reply-plugins';
import { cn } from '@/lib/utils';
import { useOptionalShellPick } from '@/shell-context';

/**
 * Streamed assistant markdown. Tolerates incomplete fences mid-stream.
 *
 * Typographic styling comes from the renderer itself. This carried a long
 * `prose-*` class list for a while, but `@tailwindcss/typography` is not
 * installed in this workspace, so none of those classes ever produced a rule —
 * the built stylesheet contained the string and no `.prose` block. They are
 * removed rather than made real, because what shipped all along is the
 * renderer's own styling and switching to Typography now would be a visual
 * change, not a fix. `max-w-none` and the wrap rule are core utilities and stay.
 *
 * Lists are the exception, and they are ours. The renderer sets
 * `list-style-position: inside` with no padding, which flattens nesting, wraps a
 * long line back under its own marker, and gives a task item a bullet next to its
 * checkbox. That was fixed once in `index.css` under a `.felix-markdown` handle,
 * which worked and was a *silent* coupling: a selector aimed at someone else's
 * markup keeps compiling after that markup moves, and stops matching without
 * failing anything. Overriding the three components instead moves the same
 * styling into code the type checker and the tests already reach.
 *
 * `components` merges over the renderer's own map per element, so this replaces
 * `ul`/`ol`/`li` and inherits everything else — the code block in particular, whose
 * chrome has to stay in CSS because owning `pre` would mean giving up Shiki.
 */

/**
 * A single newline inside a paragraph is a *soft* break in CommonMark: it renders as a
 * space, and three lines become one. That is right for prose hard-wrapped at 80 columns
 * and wrong for everything a model actually sends a bare newline in — a haiku, an
 * address, a list of names, an ASCII table outside a fence — all of which arrived as one
 * run-on line. The newline survived into the DOM, so it looked like a CSS problem and is
 * not: HTML collapses it, and only a `<br>` stops it.
 *
 * The cost is the inverse case, prose the model hard-wrapped itself, which now breaks
 * where it was wrapped. That is the trade every chat renderer makes, and it is the right
 * way round: a model that emits a bare newline usually means it.
 *
 * Unlike `components` above, `remarkPlugins` does **not** merge: the prop defaults to the
 * renderer's own four — gfm, math, and two CJK plugins — and passing a list replaces all
 * of them, so a one-plugin array here would quietly cost tables, strikethrough and task
 * lists. `defaultRemarkPlugins` exists for this, keyed by name rather than an array,
 * hence `Object.values`. `tests/response.test.tsx` holds the two that would go silently.
 */
export const responseRemarkPlugins = [...Object.values(defaultRemarkPlugins), remarkBreaks];

export type Components = NonNullable<StreamdownProps['components']>;

/**
 * Markers outside, with padding for them to sit in. The padding is what a wrapped
 * line aligns to, and it is also why a nested list reads as nested: it gets its own.
 */
const LIST = 'list-outside whitespace-normal pl-6 [li>&]:mt-1';

/**
 * Headings at the reply's own size. The renderer's run 30/24/20/18px, so a
 * model's `# Summary` became the largest text on screen — larger than the
 * empty thread's welcome, which DESIGN.md makes the one element above 16px.
 * A reply is prose at 16px, so a heading cannot outsize it: `#` and `##` are
 * the body size in semibold, `###` in medium, and the rest the 13px title,
 * muted. Space above does the separating that size used to.
 */
const HEADING = {
  h1: 'mt-6 mb-2 text-base font-semibold',
  h2: 'mt-6 mb-2 text-base font-semibold',
  h3: 'mt-5 mb-1.5 text-base font-medium',
  h4: 'mt-4 mb-1 text-sm font-semibold text-muted-foreground',
  h5: 'mt-4 mb-1 text-sm font-semibold text-muted-foreground',
  h6: 'mt-4 mb-1 text-sm font-semibold text-muted-foreground',
} as const;

export const responseComponents: Components = {
  h1: ({ node: _node, className, ...props }) => (
    <h1 className={cn(HEADING.h1, 'first:mt-0', className)} {...props} />
  ),
  h2: ({ node: _node, className, ...props }) => (
    <h2 className={cn(HEADING.h2, 'first:mt-0', className)} {...props} />
  ),
  h3: ({ node: _node, className, ...props }) => (
    <h3 className={cn(HEADING.h3, 'first:mt-0', className)} {...props} />
  ),
  h4: ({ node: _node, className, ...props }) => (
    <h4 className={cn(HEADING.h4, 'first:mt-0', className)} {...props} />
  ),
  h5: ({ node: _node, className, ...props }) => (
    <h5 className={cn(HEADING.h5, 'first:mt-0', className)} {...props} />
  ),
  h6: ({ node: _node, className, ...props }) => (
    <h6 className={cn(HEADING.h6, 'first:mt-0', className)} {...props} />
  ),
  ul: ({ node: _node, className, ...props }) => (
    <ul className={cn(LIST, 'list-disc', className)} {...props} />
  ),
  ol: ({ node: _node, className, ...props }) => (
    <ol className={cn(LIST, 'list-decimal', className)} {...props} />
  ),
  // `task-list-item` arrives from remark-gfm. GitHub drops the marker on those for
  // the reason it is dropped here: the checkbox is the marker.
  li: ({ node: _node, className, ...props }) => (
    <li
      className={cn(
        'py-1 [&>p]:inline',
        className?.includes('task-list-item') &&
          'list-none [&>input]:mr-2 [&>input]:accent-primary',
        className,
      )}
      {...props}
    />
  ),
};

/** The hast node the renderer hands a component: just the parts read here. */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: { className?: unknown };
  children?: HastNode[];
}

function hastText(node: HastNode): string {
  if (node.type === 'text') return node.value ?? '';
  return (node.children ?? []).map(hastText).join('');
}

/** A fenced block's code and language, read off the `<pre>`'s own node. */
export function fencedCode(node: unknown): { code: string; language: string } | null {
  const pre = node as HastNode | undefined;
  const code = pre?.children?.find((c) => c.type === 'element' && c.tagName === 'code');
  if (!code) return null;
  const classes = code.properties?.className;
  const list = Array.isArray(classes) ? classes.map(String) : [];
  const language = list.find((c) => c.startsWith('language-'))?.slice('language-'.length) ?? '';
  return { code: hastText(code), language };
}

/**
 * A reply's code block, with one more control in its header: open it in the
 * side pane, full height, beside the reply rather than in place of it.
 *
 * The renderer's `pre` is a pass-through — the block itself, Shiki and its
 * copy and download, is drawn by its `code` — so wrapping `pre` adds to the
 * block without taking it over. The control sits in the header's row, just
 * before the renderer's own two, which is why its offsets are the header's
 * padding and theirs; `tests/response.test.tsx` pins that it is there. A
 * diagram (`mermaid`) is not code to read, and is left as it is.
 */
function OpenablePre({ node, children }: { node?: unknown; children?: ReactNode }) {
  const openInPane = useOptionalShellPick('openInPane')?.openInPane;
  const fenced = openInPane ? fencedCode(node) : null;
  if (!openInPane || !fenced || fenced.language === 'mermaid') return <>{children}</>;
  const lines = fenced.code.replace(/\n$/, '').split('\n').length;
  return (
    <div className="relative" data-slot="openable-code">
      {children}
      <button
        type="button"
        title="Open in the side pane"
        aria-label={`Open this ${fenced.language || 'code'} block in the side pane`}
        onClick={() =>
          openInPane({
            kind: 'code',
            code: fenced.code,
            language: fenced.language,
            title: `${fenced.language || 'Code'} · ${lines} ${lines === 1 ? 'line' : 'lines'}`,
          })
        }
        className="absolute top-[13px] right-[73px] cursor-pointer rounded p-1 text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
      >
        <PanelRightOpenIcon aria-hidden size={14} />
      </button>
    </div>
  );
}

/** A reply's own map: the shared one, plus the code block's Open. */
const replyComponents: Components = { ...responseComponents, pre: OpenablePre };

/**
 * The wrap rule is `wrap-break-word`, deliberately not the `wrap-anywhere` the
 * operator's own turn uses. Both break a hash or a path that has no space in it
 * once it would overflow a line, which is what keeps a long token from widening
 * the transcript. They differ in what they do to a box's *minimum* width:
 * `anywhere` lets every word count as breakable there, so a table would squeeze
 * its columns down to a letter each instead of scrolling inside the renderer's
 * own `overflow-x-auto` wrapper. `break-word` leaves words whole for sizing,
 * which is what lets tables and code blocks scroll within their own box.
 * Links carry `wrap-anywhere` from the renderer already.
 */
export function Response({ children, className }: { children: string; className?: string }) {
  // KaTeX loads with the first reply that has math in it, and `rehype-raw` with the first
  // that has raw HTML — see `lib/reply-plugins.ts`. Until then the math shows as its source,
  // and the HTML is missing, for a moment. The swap is a remount (the `key`), because
  // streamdown's own `memo` compares `children`, the theme, `mode` and `isAnimating` and
  // nothing else: a new plugin list alone never reaches the blocks, and the math stayed as
  // source.
  const [loaded, setLoaded] = useState(loadedPlugins);
  const wantsMath = needsMath(children);
  const wantsRaw = needsRaw(children);
  useEffect(() => {
    if ((!wantsMath || loaded.math) && (!wantsRaw || loaded.raw)) return;
    let live = true;
    void loadPlugins({ math: wantsMath, raw: wantsRaw }).then(() => {
      const now = loadedPlugins();
      if (live && (now.math !== loaded.math || now.raw !== loaded.raw)) setLoaded(now);
    });
    return () => {
      live = false;
    };
  }, [wantsMath, wantsRaw, loaded]);
  const rehypePlugins = pluginsFor(loaded);
  return (
    <Streamdown
      key={`${loaded.math ? 'math' : 'plain'}${loaded.raw ? '+raw' : ''}`}
      className={cn('max-w-none wrap-break-word', className)}
      components={replyComponents}
      remarkPlugins={responseRemarkPlugins}
      rehypePlugins={rehypePlugins}
    >
      {children}
    </Streamdown>
  );
}
