import type * as React from 'react';

import { type FieldSize, fieldChrome, fieldSize } from './lib/field';
import { cn } from './lib/utils';

function Input({
  className,
  type,
  size = 'default',
  ...props
}: Omit<React.ComponentProps<'input'>, 'size'> & { size?: FieldSize }) {
  return (
    <input
      type={type}
      data-slot="input"
      data-size={size}
      className={cn(
        fieldChrome,
        fieldSize[size],
        'w-full min-w-0 py-1 file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
