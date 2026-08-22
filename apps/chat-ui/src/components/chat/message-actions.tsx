import { CheckIcon, CopyIcon, RefreshCwIcon } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@felix/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@felix/ui/tooltip';
import { cn } from '@/lib/utils';

/**
 * Hover / focus actions for a transcript turn. Copy on any text turn;
 * Regenerate only on the last assistant turn.
 */
export function MessageActions({
  content,
  onRegenerate,
  className,
}: {
  content: string;
  onRegenerate?: () => void;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard unavailable — no-op
    }
  }

  if (!content && !onRegenerate) return null;

  return (
    <div
      className={cn(
        'flex items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:focus-within:opacity-100',
        className,
      )}
    >
      {content && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7 text-muted-foreground"
              onClick={copy}
              aria-label="Copy message"
            >
              {copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>{copied ? 'Copied' : 'Copy'}</TooltipContent>
        </Tooltip>
      )}
      {onRegenerate && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              className="size-7 text-muted-foreground"
              onClick={onRegenerate}
              aria-label="Regenerate response"
            >
              <RefreshCwIcon className="size-3.5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Regenerate</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}
