// @vitest-environment happy-dom
import { TooltipProvider } from '@felix/ui/tooltip';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InstallHint } from '../src/components/chat/install-hint';

/**
 * Who is offered the install line, and that "no" is remembered.
 *
 * It is only for a touch-first device that is not already installed: a desk
 * has nothing to gain from a home-screen icon, and an installed app being told
 * to install itself is noise. Safari has no prompt a page can raise, so on iOS
 * the line names the menu item instead of offering a button.
 */

function device({
  coarse,
  standalone = false,
  ua,
}: {
  coarse: boolean;
  standalone?: boolean;
  ua: string;
}) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches:
      (query === '(pointer: coarse)' && coarse) ||
      (query === '(display-mode: standalone)' && standalone),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  Object.defineProperty(navigator, 'userAgent', { configurable: true, get: () => ua });
}

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15';
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15';

const mount = () =>
  render(
    <TooltipProvider>
      <InstallHint />
    </TooltipProvider>,
  );

beforeEach(() => localStorage.removeItem('felix.installHint'));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the install line', () => {
  it('tells an iPhone in Safari where Add to Home Screen is', () => {
    device({ coarse: true, ua: IPHONE });
    mount();
    expect(screen.getByText('Add to Home Screen')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Install' })).toBeNull();
  });

  it('says nothing once installed', () => {
    device({ coarse: true, standalone: true, ua: IPHONE });
    const { container } = mount();
    expect(container.textContent).toBe('');
  });

  it('says nothing at a desk', () => {
    device({ coarse: false, ua: MAC });
    const { container } = mount();
    expect(container.textContent).toBe('');
  });

  it('stays gone once dismissed', () => {
    device({ coarse: true, ua: IPHONE });
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss install suggestion' }));
    expect(screen.queryByText('Add to Home Screen')).toBeNull();
    cleanup();
    const { container } = mount();
    expect(container.textContent).toBe('');
  });
});
