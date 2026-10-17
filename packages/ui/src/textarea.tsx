import * as React from 'react';
import { fieldSurface } from './lib/field';
import { cn } from './lib/utils';

/** `default` is prose at 14px; `sm` is 12px, for dense editors (a skill's frontmatter, a step's JSON). */
const textareaSize = {
  default: 'px-3 py-2 text-sm',
  sm: 'px-2.5 py-1.5 text-xs',
} as const;

export const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.TextareaHTMLAttributes<HTMLTextAreaElement> & { size?: keyof typeof textareaSize }
>(({ className, size = 'default', ...props }, ref) => {
  return (
    <textarea
      className={cn(
        fieldSurface,
        // 12px corners, not the pill: a pill's ends would cut into text that wraps.
        textareaSize[size],
        'flex min-h-[60px] w-full rounded-md placeholder:text-muted-foreground',
        className,
      )}
      ref={ref}
      data-slot="textarea"
      data-size={size}
      {...props}
    />
  );
});
Textarea.displayName = 'Textarea';
