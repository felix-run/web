import { Toaster as Sonner } from 'sonner';
import { useTheme } from './theme-provider';

/**
 * The app's one toast surface, and the only place its configuration lives.
 *
 * This used to be a bare `<Toaster position="top-center" richColors closeButton />`
 * in `main.tsx`. Nine words, and they imported a second visual system: sonner ships
 * its own palette, font stack, radius and timings, and — the part that actually
 * showed — defaults `theme` to `"light"` regardless of what the page is doing.
 * Measured in dark mode, the result was a `rgb(255,240,240)` slab reading 18.97:1
 * against a near-black page, carrying text at 4.35:1 (AA wants 4.5:1 at 13px), to
 * report a mistyped slash command. All four of sonner's `richColors` variants fail
 * AA at that size: error 4.36, success 4.29, info 4.35, warning 3.07.
 *
 * It also failed in the least detectable way available. A developer working in
 * light mode never sees any of it.
 *
 * `richColors` stays on, because the per-type colour is the point: this is a
 * surface where "healthy / waiting / failed" is the fastest thing to read. What
 * changes is where the colour comes from. `index.css` redefines sonner's own
 * `--error-*` / `--success-*` / `--info-*` / `--warning-*` variables from the
 * app's `--state-failed` / `--state-done` / `--state-running` / `--state-blocked`,
 * so a failed toast and a failed tool card are finally the same red.
 */
export function Toaster() {
  const { resolved } = useTheme();

  return (
    <Sonner
      theme={resolved}
      position="top-center"
      richColors
      closeButton
      // Sonner otherwise measures its own gaps in px against a font stack that is
      // not ours; `toastOptions.className` is left alone so the palette stays in
      // one place, in CSS, next to the tokens it reads.
    />
  );
}
