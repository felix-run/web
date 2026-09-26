/**
 * The workbench's keyboard layer, as a pure function and a table.
 *
 * One `keydown` listener on the document, owned by the shell, asks `route()` what
 * a key means and does it. The decision is pure so every rung of the precedence
 * chain can be pinned without mounting the app — the terminal client learned
 * that the hard way (`apps/tui/src/keys.ts`), where the rule that mattered most
 * went unpinned for as long as it was only reachable by pressing a real key.
 *
 * Four rules decide the shape, in order:
 *
 * 1. **An open overlay owns the keyboard.** A dialog, menu, popover or listbox
 *    that Radix has open is modal in intent even when it is not in fact — a key
 *    that toggled a rail behind a confirmation would move the thing the
 *    confirmation is about. The one exception is the narrow-width drawer a
 *    binding opened: its own binding closes it, or a toggle would only toggle
 *    one way.
 * 2. **Typing is not a command.** A key with no modifier never fires from an
 *    input, a textarea or anything `contenteditable`. The composer is where
 *    focus lives most of the time, so every binding an operator needs *from*
 *    there carries a modifier; only "focus the composer" is a bare key, because
 *    from inside the composer it would mean nothing.
 * 3. **No browser or OS default is taken.** Most of `Mod+<letter>` already
 *    belongs to someone: ⌘J/Ctrl+J is downloads, Ctrl+B and Ctrl+I open Firefox
 *    sidebars, ⌘. stops a load in Safari (and could cut a stream), ⌘/ toggles
 *    Safari's status bar, ⌘⇧\ is Safari's tab overview, `Mod+[`/`]` are back and
 *    forward, and most `Mod+Shift+<letter>` open developer tools. What is left
 *    is `\`, `'`, `;` and `K` — the last being the one every browser lets a
 *    page claim, which is why so many apps use it to jump somewhere.
 *    `Ctrl+Alt` is never used: on Windows it *is* AltGr, which types characters.
 * 4. **Nothing here decides an approval.** Approving authorises every
 *    byte-identical call until the grant expires, and on the write path that is
 *    a write to disk. A global key for it would put that one stray keystroke
 *    away. The binding below moves focus to the card and stops there — onto the
 *    card, not its Approve button, so the Enter that follows a shortcut by habit
 *    does nothing. The decision is still a Tab and a deliberate press away.
 */

export type ShortcutAction =
  | 'toggle-workspace'
  | 'toggle-instrument'
  | 'open-threads'
  | 'focus-approval'
  | 'focus-composer';

/**
 * Which overlay has the keyboard.
 *
 * The two drawers are named because a binding opened them and the same binding
 * has to be able to close them; anything else Radix has open is `other`.
 */
export type Overlay = 'none' | 'workspace-drawer' | 'instrument-drawer' | 'other';

export interface ShortcutState {
  /** Mac reads `Mod` as ⌘ (metaKey); everywhere else it is Ctrl. */
  mac: boolean;
  /** Focus is in an input, textarea, select or contenteditable. */
  typing: boolean;
  overlay: Overlay;
  /**
   * Which address is on screen. The zones, the thread popover and the composer
   * only exist on the workbench; the attention line — and so a pending
   * approval — is on both.
   */
  surface: 'workbench' | 'harness';
}

/** The part of a `KeyboardEvent` the router reads, so tests need no DOM. */
export interface KeyInput {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  repeat?: boolean;
  isComposing?: boolean;
  defaultPrevented?: boolean;
}

export interface Shortcut {
  action: ShortcutAction;
  /** `KeyboardEvent.key`, lower-cased for letters. */
  key: string;
  mod: boolean;
  /** What the binding does, in the words the hint and the button titles use. */
  what: string;
}

/**
 * Every binding, as data: the hint, the button titles and `aria-keyshortcuts`
 * all read from here, so what is advertised cannot drift from what is routed.
 */
export const SHORTCUTS: readonly Shortcut[] = Object.freeze([
  { action: 'toggle-workspace', key: '\\', mod: true, what: 'Workspace' },
  { action: 'toggle-instrument', key: "'", mod: true, what: 'This run' },
  { action: 'open-threads', key: 'k', mod: true, what: 'Threads' },
  { action: 'focus-approval', key: ';', mod: true, what: 'What is waiting' },
  { action: 'focus-composer', key: '/', mod: false, what: 'Message box' },
]);

function binding(action: ShortcutAction): Shortcut {
  const found = SHORTCUTS.find((s) => s.action === action);
  // Unreachable while `SHORTCUTS` lists every action, which the tests assert.
  if (!found) throw new Error(`no binding for ${action}`);
  return found;
}

/** `aria-keyshortcuts` spells modifiers by their `KeyboardEvent` names. */
export function ariaShortcut(action: ShortcutAction, mac: boolean): string {
  const s = binding(action);
  const key = s.key.length === 1 ? s.key.toUpperCase() : s.key;
  return s.mod ? `${mac ? 'Meta' : 'Control'}+${key}` : key;
}

/** The keys as drawn, one entry per cap: `['⌘', 'K']` or `['Ctrl', 'K']`. */
export function shortcutKeys(action: ShortcutAction, mac: boolean): string[] {
  const s = binding(action);
  const key = s.key.toUpperCase();
  return s.mod ? [mac ? '⌘' : 'Ctrl', key] : [key];
}

/** The keys as one string, for a `title`: `⌘K` on a Mac, `Ctrl+K` elsewhere. */
export function shortcutLabel(action: ShortcutAction, mac: boolean): string {
  return shortcutKeys(action, mac).join(mac ? '' : '+');
}

/**
 * What this key means right now, or `null` for "not ours".
 *
 * A non-null result is also the caller's cue to `preventDefault`, which is how
 * `/` focuses the composer without typing itself into it.
 */
export function route(event: KeyInput, state: ShortcutState): ShortcutAction | null {
  // Someone nearer the target already handled it (the composer's slash menu
  // takes Escape and the arrows), and an IME mid-composition is still deciding
  // what the key is. Held keys repeat, and a toggle that flaps is not a toggle.
  if (event.defaultPrevented || event.isComposing || event.repeat) return null;

  // `Mod` is exactly one modifier. Ctrl on a Mac is not ⌘, and Alt anywhere is
  // either a different character (Option on a Mac) or AltGr (Ctrl+Alt on Windows).
  const mod = state.mac
    ? event.metaKey && !event.ctrlKey && !event.altKey
    : event.ctrlKey && !event.metaKey && !event.altKey;
  const bare = !event.metaKey && !event.ctrlKey && !event.altKey;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;

  const match = SHORTCUTS.find((s) => {
    if (s.key !== key) return false;
    if (s.mod ? !mod : !bare) return false;
    // Shift is only meaningful on a letter: `Mod+Shift+K` is Firefox's web
    // console. On punctuation it is left alone, because some layouts need it to
    // produce `;` or `'` at all, and on US it changes `event.key` anyway.
    if (/^[a-z]$/.test(s.key) && event.shiftKey) return false;
    return true;
  });
  if (!match) return null;

  if (state.overlay === 'other') return null;
  if (state.overlay === 'workspace-drawer') {
    // The thread popover lives inside this drawer, so reaching it is not
    // reaching past the modal.
    return match.action === 'toggle-workspace' || match.action === 'open-threads'
      ? match.action
      : null;
  }
  if (state.overlay === 'instrument-drawer') {
    return match.action === 'toggle-instrument' ? match.action : null;
  }

  if (!match.mod && state.typing) return null;
  if (state.surface === 'harness' && match.action !== 'focus-approval') return null;
  return match.action;
}

/** Whether focus is somewhere a bare key is text. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    // A checkbox or a button-typed input takes no text, so a bare key there is ours.
    return ![
      'button',
      'checkbox',
      'radio',
      'reset',
      'submit',
      'image',
      'file',
      'range',
      'color',
    ].includes(target.type);
  }
  return false;
}

/**
 * Which overlay is open, read from the DOM Radix renders.
 *
 * Radix portals open content with its role and removes it when closed — except
 * during an exit animation, when it is still present with `data-state="closed"`,
 * which is why that is excluded. Tooltips are deliberately not in the list: one
 * is open whenever a pointer rests on a header button, and it holds no keys.
 */
export function openOverlay(doc: Document = document): Overlay {
  const open = Array.from(
    doc.querySelectorAll<HTMLElement>(
      '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]',
    ),
  ).filter((el) => el.getAttribute('data-state') !== 'closed');
  if (open.length === 0) return 'none';
  if (open.length === 1) {
    const surface = open[0]?.getAttribute('data-shortcut-surface');
    if (surface === 'workspace') return 'workspace-drawer';
    if (surface === 'instrument') return 'instrument-drawer';
  }
  return 'other';
}

export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false;
  const platform =
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.platform ??
    '';
  return /mac|iphone|ipad|ipod/i.test(platform);
}

/**
 * Run `then` on the first element matching `selector`, waiting a few frames for
 * it to mount.
 *
 * Opening a zone and then reaching into it is two renders, and the second one
 * is React's to schedule. A dozen frames is far longer than a commit takes and
 * short enough that a target that never appears (the zone is on another
 * address) gives up quietly rather than acting late on something else.
 */
export function whenMounted(selector: string, then: (el: HTMLElement) => void, frames = 12): void {
  const el = document.querySelector<HTMLElement>(selector);
  if (el) {
    then(el);
    return;
  }
  if (frames <= 0) return;
  requestAnimationFrame(() => whenMounted(selector, then, frames - 1));
}
