import remarkBreaks from 'remark-breaks';
import { defaultRemarkPlugins, Streamdown, type StreamdownProps } from 'streamdown';
import { cn } from '@/lib/utils';

/**
 * Streamed assistant markdown. Tolerates incomplete fences mid-stream.
 *
 * Typographic styling comes from the renderer itself. This carried a long
 * `prose-*` class list for a while, but `@tailwindcss/typography` is not
 * installed in this workspace, so none of those classes ever produced a rule —
 * the built stylesheet contained the string and no `.prose` block. They are
 * removed rather than made real, because what shipped all along is the
 * renderer's own styling and switching to Typography now would be a visual
 * change, not a fix. `max-w-none` and `break-words` are core utilities and stay.
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
const remarkPlugins = [...Object.values(defaultRemarkPlugins), remarkBreaks];

type Components = NonNullable<StreamdownProps['components']>;

/**
 * Markers outside, with padding for them to sit in. The padding is what a wrapped
 * line aligns to, and it is also why a nested list reads as nested: it gets its own.
 */
const LIST = 'list-outside whitespace-normal pl-6 [li>&]:mt-1';

const components: Components = {
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

export function Response({ children, className }: { children: string; className?: string }) {
  return (
    <Streamdown
      className={cn('max-w-none break-words', className)}
      components={components}
      remarkPlugins={remarkPlugins}
    >
      {children}
    </Streamdown>
  );
}
