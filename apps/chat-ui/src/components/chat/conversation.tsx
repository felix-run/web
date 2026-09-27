import { Button } from '@felix/ui/button';
import { ArrowDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';
import { cn } from '@/lib/utils';
import { useShell } from '@/shell-context';

/**
 * Auto-scrolling transcript. Sticks to the bottom while streaming; a jump
 * button appears when the user scrolls up.
 *
 * **One scroller per thread.** The route does not remount on `/t/a` → `/t/b`,
 * so this used to be one `StickToBottom` for the life of the tab — and its lock
 * outlived the thread it was about. Scroll up in one thread, open another, and
 * the library's "the reader escaped" flag was still set: every resize as the new
 * transcript arrived was told not to follow, so the thread opened at whatever
 * offset the last one was left at — mid-prompt, above the outcome. Keyed on the
 * thread, each one opens with a fresh lock and lands at its end.
 *
 * `initial="instant"` for the same reason: opening a thread should put its
 * outcome on screen, not animate down to it through everything before. The
 * spring stays for `resize`, where it follows a reply being written. Both run on
 * `requestAnimationFrame`, so in a hidden tab — which is what an automated
 * browser reports — neither moves until the tab is shown. A driver reading
 * `scrollTop` there is reading a scroll that has not happened yet.
 */
export function Conversation({ children, className }: { children: ReactNode; className?: string }) {
  const { threadId } = useShell();
  return (
    <StickToBottom
      key={threadId}
      data-slot="conversation"
      className={cn('relative min-h-0 flex-1 overflow-hidden', className)}
      initial="instant"
      resize="smooth"
    >
      {/* `min-h-full` gives a `flex-1` child (the empty-state greeting) the whole
          column to centre in. With turns present the content is taller and this is
          inert. */}
      <StickToBottom.Content className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
        {children}
      </StickToBottom.Content>
      <ScrollToBottom />
    </StickToBottom>
  );
}

function ScrollToBottom() {
  const { isAtBottom, scrollToBottom } = useStickToBottomContext();
  if (isAtBottom) return null;
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="outline"
      className="absolute bottom-4 left-1/2 z-10 -translate-x-1/2 rounded-full border-border/60 bg-card/90 shadow-md backdrop-blur"
      onClick={() => scrollToBottom()}
      aria-label="Scroll to latest"
    >
      <ArrowDownIcon className="size-4" />
    </Button>
  );
}
