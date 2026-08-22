import { Streamdown } from 'streamdown';
import { cn } from '@/lib/utils';

/**
 * Streamed assistant markdown. Tolerates incomplete fences mid-stream.
 */
export function Response({ children, className }: { children: string; className?: string }) {
  return (
    <Streamdown
      className={cn(
        'prose prose-sm dark:prose-invert max-w-none break-words',
        'prose-p:my-2.5 prose-p:leading-relaxed',
        'prose-headings:mb-2 prose-headings:mt-4 prose-headings:font-semibold',
        'prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5',
        'prose-pre:my-3 prose-pre:overflow-x-auto prose-pre:rounded-xl prose-pre:border prose-pre:border-border/50',
        'prose-code:rounded prose-code:bg-muted/60 prose-code:px-1 prose-code:py-0.5 prose-code:text-[0.85em] prose-code:before:content-none prose-code:after:content-none',
        'prose-a:text-foreground prose-a:underline prose-a:underline-offset-2',
        className,
      )}
    >
      {children}
    </Streamdown>
  );
}
