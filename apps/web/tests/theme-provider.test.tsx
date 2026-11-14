/** @vitest-environment happy-dom */
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider, useTheme } from '../src/components/theme-provider';

/**
 * The theme provider owns three side effects that are easy to get subtly wrong:
 * it persists the choice, it toggles the `.dark` class the shadcn tokens key
 * off, and it keeps following the OS while `system` is selected. The last one
 * is the one that silently regresses — it needs a live matchMedia listener, not
 * a read at mount.
 */

let listeners: Array<(e: { matches: boolean }) => void>;
let systemDark: boolean;

function mockMatchMedia() {
  listeners = [];
  window.matchMedia = ((query: string) => ({
    // A real MediaQueryList.matches is live — the provider's handler reads
    // mq.matches rather than the event, so a frozen value here would fail the
    // very behavior these tests exist to pin down.
    get matches() {
      return query.includes('dark') ? systemDark : false;
    },
    media: query,
    addEventListener: (_: string, fn: (e: { matches: boolean }) => void) => listeners.push(fn),
    removeEventListener: (_: string, fn: (e: { matches: boolean }) => void) => {
      listeners = listeners.filter((l) => l !== fn);
    },
    dispatchEvent: () => true,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
  })) as unknown as typeof window.matchMedia;
}

/** Flip the OS preference and notify the subscriber, as the browser would. */
function setSystemDark(next: boolean) {
  systemDark = next;
  act(() => {
    for (const l of [...listeners]) l({ matches: next });
  });
}

function Probe() {
  const { theme, resolved, setTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <span data-testid="resolved">{resolved}</span>
      <button type="button" onClick={() => setTheme('dark')}>
        dark
      </button>
      <button type="button" onClick={() => setTheme('system')}>
        system
      </button>
    </div>
  );
}

const renderProvider = () =>
  render(
    <ThemeProvider>
      <Probe />
    </ThemeProvider>,
  );

beforeEach(() => {
  localStorage.clear();
  systemDark = false;
  mockMatchMedia();
  document.documentElement.className = '';
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ThemeProvider', () => {
  it('defaults to system', () => {
    renderProvider();
    expect(screen.getByTestId('theme').textContent).toBe('system');
    expect(screen.getByTestId('resolved').textContent).toBe('light');
  });

  it('resolves system to dark when the OS prefers dark', () => {
    systemDark = true;
    renderProvider();
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
  });

  it('applies the dark class the design tokens key off', () => {
    systemDark = true;
    renderProvider();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.colorScheme).toBe('dark');
  });

  it('removes the dark class when resolving to light', () => {
    document.documentElement.classList.add('dark');
    renderProvider();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('persists an explicit choice', () => {
    renderProvider();
    act(() => screen.getByText('dark').click());
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(localStorage.getItem('felix.theme')).toBe('dark');
  });

  it('restores the stored choice on the next mount', () => {
    localStorage.setItem('felix.theme', 'dark');
    renderProvider();
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
  });

  it('falls back to system for unrecognized stored data', () => {
    localStorage.setItem('felix.theme', 'chartreuse');
    renderProvider();
    expect(screen.getByTestId('theme').textContent).toBe('system');
  });

  // The point of tracking matchMedia rather than reading it once.
  it('follows the OS live while system is selected', () => {
    renderProvider();
    expect(screen.getByTestId('resolved').textContent).toBe('light');
    setSystemDark(true);
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('ignores the OS once a theme is chosen explicitly', () => {
    renderProvider();
    act(() => screen.getByText('dark').click());
    setSystemDark(false);
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
  });

  it('starts following the OS again when switched back to system', () => {
    localStorage.setItem('felix.theme', 'dark');
    renderProvider();
    act(() => screen.getByText('system').click());
    setSystemDark(true);
    expect(screen.getByTestId('resolved').textContent).toBe('dark');
    setSystemDark(false);
    expect(screen.getByTestId('resolved').textContent).toBe('light');
  });

  it('unsubscribes from matchMedia on unmount', () => {
    const { unmount } = renderProvider();
    expect(listeners.length).toBe(1);
    unmount();
    expect(listeners.length).toBe(0);
  });

  it('refuses to be used outside a provider', () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Probe />)).toThrow(/must be used within a ThemeProvider/);
    quiet.mockRestore();
  });
});
