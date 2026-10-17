/**
 * The one-line field's chrome, shared by `Input` and `SelectTrigger` so the two can never drift:
 * a 32px pill (36px on a coarse pointer) on the field wash, with the app's focus ring. Every
 * call site used to restate height, text size and padding, and they had settled on four of each.
 *
 * `default` is a form field at 14px. `sm` is the same pill at 12px, for a control inside a dense
 * row or a toolbar (a filter beside 12px buttons, a step in the plan editor). Height does not
 * change with size: a row of mixed fields and buttons stays on one line.
 */
export const fieldSize = {
  default: 'px-3.5 text-sm',
  sm: 'px-3 text-xs',
} as const;

export type FieldSize = keyof typeof fieldSize;

export const fieldChrome =
  'h-8 coarse:h-9 rounded-full border border-input bg-input/30 transition-[color,background-color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive dark:aria-invalid:border-destructive/50';
