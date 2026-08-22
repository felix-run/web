import { ArrowDownIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { StickToBottom, useStickToBottomContext } from 'use-stick-to-bottom';
import { Button } from '@felix/ui/button';
import { cn } from '@/lib/utils';

/**
 * Auto-scrolling transcript. Sticks to the bottom while streaming; a jump
 * button appears when the user scrolls up.
 */
export function Conversation({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <StickToBottom
      className={cn('relative min-h-0 flex-1 overflow-hidden', className)}
      initial="smooth"
      resize="smooth"
    >
      <StickToBottom.Content className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8">
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
