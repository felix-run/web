// @vitest-environment happy-dom
import { act, cleanup, render, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  enterAction,
  resetHardwareKeyboardForTests,
} from '../src/components/ai-elements/prompt-input';
import { ThemeProvider } from '../src/components/theme-provider';
import { useVisualViewport } from '../src/hooks/use-visual-viewport';

/**
 * What a phone or tablet needs that a desk does not, at the seams where it can be
 * pinned without a device: what Enter does, what the shell's height follows while
 * a keyboard is up, and what colour the browser chrome is told to paint. The rest
 * — insets under a real notch, Safari's scroll on focus — is verified on hardware.
 */

function stubPointer(coarse: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(pointer: coarse)' ? coarse : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

const key = (
  k: string,
  mods: Partial<Record<'shiftKey' | 'metaKey' | 'ctrlKey' | 'altKey', boolean>> = {},
) => ({
  key: k,
  shiftKey: false,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...mods,
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  resetHardwareKeyboardForTests();
});

describe('enterAction', () => {
  it('sends on Enter and breaks the line on Shift+Enter at a desk', () => {
    stubPointer(false);
    expect(enterAction(key('Enter'))).toBe('send');
    expect(enterAction(key('Enter', { shiftKey: true }))).toBe('newline');
    expect(enterAction(key('a'))).toBeNull();
  });

  it('breaks the line on Enter with a soft keyboard, which has no Shift+Return', () => {
    stubPointer(true);
    expect(enterAction(key('Enter'))).toBe('newline');
  });

  it('sends on ⌘/Ctrl+Enter everywhere', () => {
    stubPointer(true);
    expect(enterAction(key('Enter', { metaKey: true }))).toBe('send');
    expect(enterAction(key('Enter', { ctrlKey: true }))).toBe('send');
  });

  it('goes back to Enter-sends once a hardware keyboard shows itself', () => {
    stubPointer(true);
    expect(enterAction(key('Enter'))).toBe('newline');
    // An arrow is a key no on-screen keyboard sends: an iPad with a keyboard attached.
    enterAction(key('ArrowUp'));
    expect(enterAction(key('Enter'))).toBe('send');
  });
});

describe('useVisualViewport', () => {
  let vv: EventTarget & { height: number; offsetTop: number; scale: number };

  beforeEach(() => {
    vv = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
    vi.stubGlobal('visualViewport', vv);
    vi.stubGlobal('innerHeight', 800);
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
      // Run at once and report no frame pending, as a real frame would by the
      // time the next event arrives.
      cb(0);
      return 0;
    });
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  const root = () => document.documentElement;

  it('sizes the shell to what the keyboard leaves while a field has focus', () => {
    renderHook(() => useVisualViewport());
    const field = document.createElement('textarea');
    document.body.appendChild(field);
    field.focus();
    vv.height = 460;
    act(() => {
      vv.dispatchEvent(new Event('resize'));
    });
    expect(root().style.getPropertyValue('--vvh')).toBe('460px');
    expect('keyboard' in root().dataset).toBe(true);

    vv.height = 800;
    act(() => {
      vv.dispatchEvent(new Event('resize'));
    });
    expect(root().style.getPropertyValue('--vvh')).toBe('');
    expect('keyboard' in root().dataset).toBe(false);
  });

  it('leaves a pinch-zoom alone', () => {
    renderHook(() => useVisualViewport());
    const field = document.createElement('input');
    document.body.appendChild(field);
    field.focus();
    Object.assign(vv, { height: 400, scale: 2 });
    act(() => {
      vv.dispatchEvent(new Event('resize'));
    });
    expect(root().style.getPropertyValue('--vvh')).toBe('');
  });

  it('does nothing when no field has focus', () => {
    renderHook(() => useVisualViewport());
    vv.height = 460;
    act(() => {
      vv.dispatchEvent(new Event('resize'));
    });
    expect(root().style.getPropertyValue('--vvh')).toBe('');
  });
});

describe('theme-color', () => {
  it('follows an explicit theme rather than the OS', () => {
    stubPointer(false);
    for (const media of ['(prefers-color-scheme: light)', '(prefers-color-scheme: dark)']) {
      const meta = document.createElement('meta');
      meta.name = 'theme-color';
      meta.media = media;
      document.head.appendChild(meta);
    }
    localStorage.setItem('felix.theme', 'dark');
    render(
      <ThemeProvider>
        <span />
      </ThemeProvider>,
    );
    const colors = [...document.querySelectorAll('meta[name="theme-color"]')].map((m) =>
      m.getAttribute('content'),
    );
    expect(colors).toEqual(['#09090b', '#09090b']);
    localStorage.removeItem('felix.theme');
  });
});
