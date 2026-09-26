// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../src/App';
import { ThemeProvider } from '../src/components/theme-provider';
import {
  ariaShortcut,
  isMacPlatform,
  isTypingTarget,
  type KeyInput,
  openOverlay,
  route,
  SHORTCUTS,
  type ShortcutAction,
  type ShortcutState,
  shortcutLabel,
} from '../src/lib/shortcuts';

/**
 * The workbench's keyboard layer.
 *
 * The router is pure so the precedence chain can be pinned rung by rung: an open
 * overlay owns the keyboard, typing is not a command, `Mod` is exactly one
 * modifier, and nothing here decides an approval. The last case mounts the real
 * `App` and presses a real key, because a router nobody is listening to passes
 * every one of the others.
 */

const key = (k: string, over: Partial<KeyInput> = {}): KeyInput => ({
  key: k,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});
const ctrl = (k: string, over: Partial<KeyInput> = {}) => key(k, { ctrlKey: true, ...over });
const cmd = (k: string, over: Partial<KeyInput> = {}) => key(k, { metaKey: true, ...over });

const state = (over: Partial<ShortcutState> = {}): ShortcutState => ({
  mac: false,
  typing: false,
  overlay: 'none',
  surface: 'workbench',
  ...over,
});

describe('route', () => {
  it('maps each binding on both platforms', () => {
    expect(route(ctrl('\\'), state())).toBe('toggle-workspace');
    expect(route(ctrl("'"), state())).toBe('toggle-instrument');
    expect(route(ctrl('k'), state())).toBe('open-threads');
    expect(route(ctrl(';'), state())).toBe('focus-approval');
    expect(route(key('/'), state())).toBe('focus-composer');
    expect(route(cmd('\\'), state({ mac: true }))).toBe('toggle-workspace');
    expect(route(cmd('K'), state({ mac: true }))).toBe('open-threads');
  });

  it('reads Mod as one modifier: Ctrl is not ⌘ on a Mac, and Alt is never Mod', () => {
    expect(route(ctrl('\\'), state({ mac: true }))).toBeNull();
    expect(route(cmd('\\'), state({ mac: false }))).toBeNull();
    // Ctrl+Alt is AltGr on Windows, which types characters.
    expect(route(ctrl('\\', { altKey: true }), state())).toBeNull();
    expect(route(cmd('k', { ctrlKey: true }), state({ mac: true }))).toBeNull();
  });

  it('leaves Mod+Shift+K alone, which is a browser console', () => {
    expect(route(ctrl('K', { shiftKey: true }), state())).toBeNull();
  });

  it('keeps modified bindings working from the composer', () => {
    const typing = state({ typing: true });
    expect(route(ctrl(';'), typing)).toBe('focus-approval');
    expect(route(ctrl("'"), typing)).toBe('toggle-instrument');
    expect(route(ctrl('k'), typing)).toBe('open-threads');
  });

  it('never takes a bare key while typing — a slash is text there', () => {
    expect(route(key('/'), state({ typing: true }))).toBeNull();
    // Nor a bare key with a modifier it does not bind.
    expect(route(ctrl('/'), state())).toBeNull();
  });

  it('gives an open overlay the keyboard', () => {
    const other = state({ overlay: 'other' });
    for (const s of SHORTCUTS) {
      const input = s.mod ? ctrl(s.key) : key(s.key);
      expect(route(input, other)).toBeNull();
    }
  });

  it('lets a drawer be closed by the binding that opened it, and nothing else', () => {
    const ws = state({ overlay: 'workspace-drawer' });
    expect(route(ctrl('\\'), ws)).toBe('toggle-workspace');
    // The thread popover is inside that drawer.
    expect(route(ctrl('k'), ws)).toBe('open-threads');
    expect(route(ctrl("'"), ws)).toBeNull();
    expect(route(ctrl(';'), ws)).toBeNull();
    const inst = state({ overlay: 'instrument-drawer' });
    expect(route(ctrl("'"), inst)).toBe('toggle-instrument');
    expect(route(ctrl('\\'), inst)).toBeNull();
  });

  it('on /harness, only reaches for an approval', () => {
    const harness = state({ surface: 'harness' });
    expect(route(ctrl(';'), harness)).toBe('focus-approval');
    expect(route(ctrl('\\'), harness)).toBeNull();
    expect(route(ctrl('k'), harness)).toBeNull();
    expect(route(key('/'), harness)).toBeNull();
  });

  it('ignores a handled key, an IME composition and a held key', () => {
    expect(route(ctrl("'", { defaultPrevented: true }), state())).toBeNull();
    expect(route(ctrl("'", { isComposing: true }), state())).toBeNull();
    expect(route(ctrl("'", { repeat: true }), state())).toBeNull();
  });

  it('binds nothing that decides an approval', () => {
    const actions: ShortcutAction[] = SHORTCUTS.map((s) => s.action);
    expect(actions.some((a) => /approve|deny|decide/.test(a))).toBe(false);
    // Every plain letter and Enter, with and without Mod, is unbound.
    for (const k of ['y', 'n', 'a', 'd', 'Enter']) {
      expect(route(key(k), state())).toBeNull();
      expect(route(ctrl(k), state())).toBeNull();
    }
  });

  it('spells aria-keyshortcuts in KeyboardEvent names, and titles in the platform’s', () => {
    expect(ariaShortcut('open-threads', true)).toBe('Meta+K');
    expect(ariaShortcut('open-threads', false)).toBe('Control+K');
    expect(ariaShortcut('focus-composer', false)).toBe('/');
    expect(shortcutLabel('toggle-workspace', true)).toBe('⌘\\');
    expect(shortcutLabel('toggle-workspace', false)).toBe('Ctrl+\\');
  });
});

describe('reading the DOM', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('treats text fields as typing and buttons and checkboxes as not', () => {
    document.body.innerHTML = `
      <textarea id="t"></textarea><input id="i" /><input id="c" type="checkbox" />
      <button id="b"></button><div id="e" contenteditable="true"></div>`;
    const el = (id: string) => document.getElementById(id);
    expect(isTypingTarget(el('t'))).toBe(true);
    expect(isTypingTarget(el('i'))).toBe(true);
    expect(isTypingTarget(el('c'))).toBe(false);
    expect(isTypingTarget(el('b'))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
  });

  it('names the drawer it opened, and calls anything else other', () => {
    expect(openOverlay()).toBe('none');
    document.body.innerHTML = `<div role="dialog" data-state="open" data-shortcut-surface="instrument"></div>`;
    expect(openOverlay()).toBe('instrument-drawer');
    // A popover inside the drawer: two layers, and the inner one owns the keys.
    document.body.innerHTML += `<div role="dialog" data-state="open"></div>`;
    expect(openOverlay()).toBe('other');
    document.body.innerHTML = `<div role="menu" data-state="open"></div>`;
    expect(openOverlay()).toBe('other');
    // Mid exit-animation is closed.
    document.body.innerHTML = `<div role="dialog" data-state="closed"></div>`;
    expect(openOverlay()).toBe('none');
  });
});

describe('in the app', () => {
  /** What `/approvals` answers with; empty unless a test puts a row in it. */
  let approvals: unknown[] = [];

  beforeEach(() => {
    localStorage.clear();
    approvals = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('/chat/sessions')) {
          return new Response(JSON.stringify({ sessions: [], items: [] }), { status: 200 });
        }
        if (url.includes('/approvals')) {
          return new Response(JSON.stringify({ requests: approvals }), { status: 200 });
        }
        return new Response('{}', { status: 200 });
      }),
    );
  });

  async function mount() {
    render(
      <MemoryRouter initialEntries={['/']}>
        <ThemeProvider>
          <TooltipProvider>
            <App />
          </TooltipProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
    const box = await waitFor(() => {
      const found = document.querySelector<HTMLTextAreaElement>(
        '[data-shortcut-target="composer"]',
      );
      expect(found).toBeTruthy();
      return found as HTMLTextAreaElement;
    });
    // Outlast the composer's mount-time focus, an 80ms timer. A popover opened
    // before it fires is closed again by that focus landing outside it — a
    // startup race a person cannot hit and a test pressing keys at once would.
    // Nothing observable marks the timer done (the textarea may already be the
    // active element), so this waits it out rather than polling for it.
    await act(() => new Promise((r) => setTimeout(r, 150)));
    return box;
  }

  afterEach(() => {
    // Unmount, not just clear the body: the listener is on `document`, so a
    // shell left mounted from the last test answers every key a second time —
    // and two clicks on the thread trigger open the popover and close it.
    cleanup();
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  /** What a person presses, from wherever focus is. */
  const press = (k: string, target: EventTarget = document.body) =>
    act(() => {
      const mac = isMacPlatform();
      target.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: k,
          bubbles: true,
          cancelable: true,
          metaKey: mac,
          ctrlKey: !mac,
        }),
      );
    });

  const instrument = () => document.querySelector('[data-shortcut-surface="instrument"]');

  /**
   * Under happy-dom there is no `matchMedia` width, so the workbench takes its
   * narrow layout and the instrument is a drawer — which makes this the harder
   * case: the drawer is a modal the second press has to be allowed through.
   */
  it('toggles the run instrument from the composer, drawer and all', async () => {
    const box = await mount();
    expect(instrument()).toBeNull();

    box.focus();
    await press("'", box);
    await waitFor(() => expect(instrument()).toBeTruthy());
    expect(
      document
        .querySelector('[aria-label="Toggle run instrument"]')
        ?.getAttribute('aria-keyshortcuts'),
    ).toBe(ariaShortcut('toggle-instrument', isMacPlatform()));

    // Focus is inside the drawer now; the same binding has to close it.
    await press("'", document.activeElement ?? document.body);
    await waitFor(() => expect(instrument()).toBeNull());
  });

  it('opens the thread popover, the only thread switcher there is', async () => {
    const box = await mount();
    box.focus();
    await press('k', box);
    // The popover's content is a dialog holding the thread list's "New" action.
    await waitFor(() =>
      expect(
        [...document.querySelectorAll('[role="dialog"]')].some(
          (d) => d.getAttribute('data-shortcut-surface') === null,
        ),
      ).toBe(true),
    );
  });

  /**
   * The approval binding lands on the card, and specifically not on Approve:
   * focus on that button would leave a write to disk one habitual Enter away.
   */
  it('moves focus to a waiting approval, onto the card rather than a button', async () => {
    approvals = [
      {
        id: 'a1',
        tenant_id: 't',
        manifest_id: 'cowork',
        tool_name: 'write_file',
        call_signature: 'sig',
        args: { path: 'notes.md' },
        principal_subj: 'dev',
        status: 'pending',
        created_at: Date.now(),
        decided_at: null,
        decided_by: '',
        decision_note: '',
        edited_args: null,
        rule_id: 'workspace-write',
        ttl_seconds: 600,
        expires_at: Date.now() + 600_000,
        consumed_at: null,
      },
    ];
    const box = await mount();
    // Not stubbed as streaming, so the shell's own poll adopts the row into the
    // transcript banner — the first place the binding looks.
    await waitFor(() => expect(document.querySelector('[data-approval-focus]')).toBeTruthy());
    box.focus();
    await press(';', box);
    await waitFor(() => {
      const active = document.activeElement as HTMLElement | null;
      expect(active?.dataset.approvalFocus).toBeDefined();
      expect(active?.tagName).not.toBe('BUTTON');
    });
  });
});
