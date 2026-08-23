/**
 * Regenerate the docs site's theme CSS from the design tokens.
 *
 *   pnpm --filter @felix/design sync:theme
 *
 * `apps/docs/src/styles/theme.css` is checked in (Starlight loads it via
 * `customCss`), but it is generated — every doc in this repo says to change the
 * tokens and regenerate rather than edit the CSS, and this is the command that
 * makes that true. A PreToolUse hook blocks hand edits to the generated file.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { starlightThemeCss } from '../src/tokens';

const out = fileURLToPath(new URL('../../../apps/docs/src/styles/theme.css', import.meta.url));
const css = starlightThemeCss();

writeFileSync(out, css.endsWith('\n') ? css : `${css}\n`);
console.log(`wrote ${out} (${css.split('\n').length} lines)`);
