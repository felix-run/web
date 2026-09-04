/**
 * The precedence chain, as a pure function.
 *
 * `useKeyboard` is a *global* subscription, and two facts about it decide the
 * whole shape of this file. A handler registered by a child runs **before** the
 * one registered by its parent, because React runs child effects first — so the
 * banners in `ui/prompts.tsx` see a key before `App` does. And
 * `preventDefault()` does not stop another global handler; it only gates the
 * *focused* renderable. `stopPropagation()` is what stops a global, and nothing
 * here calls it.
 *
 * So what actually keeps the app off the keyboard while a run is waiting on a
 * person is the `blocked` rung below — an ordinary early return. That is worth
 * knowing before adding an overlay to this client: the guard is the mechanism,
 * not a belt-and-braces extra on top of `preventDefault`.
 *
 * Making the decision pure is the point. Every rung was previously only
 * reachable by mounting the whole app and pressing a key, which is why the rule
 * that matters most — a blocking prompt owns the keyboard — went unpinned for
 * as long as it did.
 */

import type { KeyEvent } from '@opentui/core';

/**
 * Which overlay owns the keyboard, as one value rather than a flag each.
 *
 * They are mutually exclusive on purpose. Both consume every key they are
 * handed and return, so two open at once is a precedence matrix with no correct
 * answer — and both are opaque boxes at the same `zIndex`, so it would also be a
 * drawing accident.
 */
export type Overlay = 'none' | 'threads' | 'inspector';

export interface KeyState {
  /** A prompt the run is waiting on: write gate, approval, or agent question. */
  blocked: boolean;
  streaming: boolean;
  /** ctrl+c was pressed once during a live run. */
  quitArmed: boolean;
  overlay: Overlay;
  railFilter: string;
  /** Whether ctrl+d has an overlay to toggle. */
  consoleAvailable: boolean;
  /** The inspector's memory search field has the keyboard. */
  searching: boolean;
}

export type Action =
  | { kind: 'quit' }
  /** Stop the live run, and arm ctrl+c to quit. */
  | { kind: 'stop' }
  | { kind: 'scroll'; by: -0.5 | 0.5 }
  | { kind: 'close-rail' }
  | { kind: 'clear-filter' }
  | { kind: 'rail-move'; by: -1 | 1 }
  | { kind: 'rail-open-selected' }
  | { kind: 'filter-backspace' }
  | { kind: 'filter-append'; char: string }
  /** esc during a run, outside the rail. */
  | { kind: 'abort' }
  | { kind: 'open-rail' }
  | { kind: 'new-thread' }
  | { kind: 'toggle-console' }
  | { kind: 'open-inspector' }
  | { kind: 'close-inspector' }
  /** Move between inspector sections. */
  | { kind: 'section'; by: -1 | 1 }
  /** Scroll the inspector's panel rather than the transcript. */
  | { kind: 'panel'; by: -1 | 1 }
  | { kind: 'refresh-section' }
  | { kind: 'search-open' }
  | { kind: 'search-close' }
  /** Claimed, and deliberately does nothing — the rail swallows what it cannot use. */
  | { kind: 'consume' };

/**
 * What this key means right now, or `null` for "not ours".
 *
 * A non-null result is also the signal to `preventDefault`, which is what stops
 * the composer typing the same key the rail is filtering on.
 */
export function route(key: KeyEvent, state: KeyState): Action | null {
  const name = key.name ?? '';

  // Above everything, including a blocking prompt: stopping a run must never be
  // unreachable, and neither must leaving.
  if (key.ctrl && name === 'c') {
    return state.quitArmed || !state.streaming ? { kind: 'quit' } : { kind: 'stop' };
  }

  // Reading back through the conversation. Half a viewport a press, which is
  // the scroll box's own step — and paging down to the bottom re-engages sticky
  // by itself, so returning to a live run needs no separate key and no mode to
  // leave. Above the guard on purpose: reading the transcript while an approval
  // is on screen is a reasonable thing to want.
  if (name === 'pageup' || name === 'pagedown') {
    return { kind: 'scroll', by: name === 'pageup' ? -0.5 : 0.5 };
  }

  // The rung that enforces "one prompt owns the keyboard".
  if (state.blocked) return null;

  // The rail takes the keyboard whole while it has focus — the same rule the
  // composer follows, for the same reason: a key that means two things does
  // both unless one handler claims it.
  // The inspector sits directly under the blocking prompts and above the rail.
  // It has no `useKeyboard` of its own: a handler registered inside it would
  // subscribe *before* this one and see keys while a banner is up.
  if (state.overlay === 'inspector') {
    // The search field is a mode, and the only one here. It earns that because
    // there is no other way to get typed text into a panel — and `escape` is
    // taken outright below, so the input never sees the key that leaves it.
    if (state.searching) {
      return name === 'escape' ? { kind: 'search-close' } : null;
    }
    if (name === 'escape') return { kind: 'close-inspector' };
    // `tab` hands the keyboard to the other overlay rather than closing onto
    // nothing, which is the pair to shift+tab opening this one.
    if (name === 'tab' && !key.shift) return { kind: 'open-rail' };
    if (name === 'tab' && key.shift) return { kind: 'close-inspector' };
    if (name === 'left' || name === 'h') return { kind: 'section', by: -1 };
    if (name === 'right' || name === 'l') return { kind: 'section', by: 1 };
    if (name === 'up') return { kind: 'panel', by: -1 };
    if (name === 'down') return { kind: 'panel', by: 1 };
    if (name === 'r') return { kind: 'refresh-section' };
    if (name === '/') return { kind: 'search-open' };
    return { kind: 'consume' };
  }

  if (state.overlay === 'threads') {
    // shift+tab swaps to the inspector; plain tab closes.
    if (name === 'tab' && key.shift) return { kind: 'open-inspector' };
    if (name === 'tab' || (name === 'escape' && !state.railFilter)) return { kind: 'close-rail' };
    if (name === 'escape') return { kind: 'clear-filter' };
    if (name === 'up') return { kind: 'rail-move', by: -1 };
    if (name === 'down') return { kind: 'rail-move', by: 1 };
    if (name === 'return') return { kind: 'rail-open-selected' };
    if (name === 'backspace' || name === 'delete') return { kind: 'filter-backspace' };
    // Chords belong to the app; arrows that are not up or down mean nothing to
    // a one-column list. Everything else is filter text.
    if (key.ctrl || key.meta || name === 'left' || name === 'right') return { kind: 'consume' };
    if (name.length === 1) return { kind: 'filter-append', char: name };
    // Consumed regardless: the rail does not fall through to the composer, or
    // the same key would filter the list *and* type into the box behind it.
    return { kind: 'consume' };
  }

  if (name === 'escape' && state.streaming) return { kind: 'abort' };
  // shift+Tab is `ESC [ Z` on every terminal and is parsed as `tab` with the
  // shift flag — so the plain-tab branch below has to say so, or it opens the
  // rail on both. `ctrl+i` is not an option for the inspector: it *is* 0x09,
  // which is `tab`, on any terminal not speaking the kitty protocol.
  if (name === 'tab' && key.shift) return { kind: 'open-inspector' };
  if (name === 'tab') return { kind: 'open-rail' };
  if (key.ctrl && name === 'n') return { kind: 'new-thread' };
  // Only bound when the overlay exists: with `consoleMode: 'disabled'` this
  // would be a key that silently does nothing, which is worse than one that is
  // not bound.
  if (key.ctrl && name === 'd' && state.consoleAvailable) return { kind: 'toggle-console' };

  return null;
}
