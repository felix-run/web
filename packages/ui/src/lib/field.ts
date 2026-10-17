/**
 * The field's surface, shared by `Input`, `SelectTrigger` and `Textarea` so none of them can drift:
 * an `--input` edge on the `input/30` wash in both themes, the focus ring at half strength (the
 * border goes to full `--ring`, which is what carries the contrast; a full-strength 3px ring on
 * top read as an alert), and one invalid state, `destructive`, for all three. Every call site
 * used to restate this, and they had settled on four heights, two invalid colours and three
 * backgrounds.
 */
export const fieldSurface =
  'border border-input bg-input/30 transition-[color,background-color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/40 dark:aria-invalid:border-destructive/70';

/**
 * The one-line field: the surface as a pill. `default` is a form field, 32px at 14px. `sm` is
 * the same height at 12px, for a control in a dense row or a toolbar (a filter beside 12px
 * buttons, a step in the plan editor), so a row of fields and `sm` buttons stays on one line.
 * `lg` is 36px at 14px, for the one field that heads a region: the sidebar's thread search.
 *
 * On a coarse pointer the two smaller sizes grow to 36px, as `Button size="sm"` does, and the
 * text goes to 16px from the unlayered rule in chat-ui's `index.css`, which covers select
 * triggers too, so a step's title and its status read at one size on an iPad.
 */
export const fieldSize = {
  default: 'h-8 coarse:h-9 px-3.5 text-sm',
  sm: 'h-8 coarse:h-9 px-3 text-xs',
  lg: 'h-9 px-4 text-sm',
} as const;

export type FieldSize = keyof typeof fieldSize;

export const fieldChrome = `rounded-full ${fieldSurface}`;
