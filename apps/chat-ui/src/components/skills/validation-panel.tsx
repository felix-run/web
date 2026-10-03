import type { ValidationIssue } from '@felix/skill-format';
import { CheckIcon, CircleAlertIcon } from 'lucide-react';

/**
 * What the harness would say about this bundle if it were saved now, checked
 * in the browser as it is typed. The harness re-checks every save and its
 * answer is the one that counts; this exists so the answer is not a surprise.
 * Each issue is a button that moves the editor to the line it is about.
 */

export function ValidationPanel({
  errors,
  onFocusError,
}: {
  errors: ValidationIssue[];
  onFocusError?: (error: ValidationIssue) => void;
}) {
  if (errors.length === 0) {
    return (
      <p className="flex items-center gap-1.5 px-3 py-2 text-xs text-muted-foreground">
        <CheckIcon className="size-3.5" aria-hidden />
        No issues: the harness should accept this bundle as it stands.
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border/60" aria-label="Validation issues">
      {errors.map((error) => (
        <li key={`${error.path}:${error.message}`}>
          <button
            type="button"
            onClick={() => onFocusError?.(error)}
            className="flex w-full items-start gap-2 px-3 py-2 text-left text-xs hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
          >
            <CircleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-state-failed" aria-hidden />
            <span className="min-w-0">
              <span className="font-mono font-medium">{error.path}</span>{' '}
              <span className="text-muted-foreground">{error.message}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
