import { Streamdown } from 'streamdown';
import { cn } from '@/lib/utils';

/**
 * Streamed assistant markdown. Tolerates unclosed fences mid-stream.
 */
export function Response({ children, className }: { children: string; className?: string }) {
  return (
    <Streamdown className={cn('max-w-none break-words text-sm', className)}>{children}</Streamdown>
  );
}
