import { Streamdown } from 'streamdown';
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
 * `felix-markdown` carries no utilities of its own — it is the handle `index.css` uses
 * to reach the list markup, which the renderer builds from plain elements and Tailwind
 * classes rather than anything addressable like the `data-streamdown` attributes on a
 * code block.
 */
export function Response({ children, className }: { children: string; className?: string }) {
  return (
    <Streamdown className={cn('felix-markdown max-w-none break-words', className)}>
      {children}
    </Streamdown>
  );
}
