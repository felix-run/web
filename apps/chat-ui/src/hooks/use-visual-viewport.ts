import { useEffect } from 'react';

/**
 * Keep the shell inside the part of the screen the on-screen keyboard leaves.
 *
 * Safari does not resize the page for its keyboard. The layout viewport keeps its
 * height, the keyboard covers the bottom of it, and Safari *scrolls the page* to
 * bring the focused field into view — which, for a shell that is exactly one
 * screen tall, slides the header and the attention line off the top and leaves
 * the composer floating wherever the scroll happened to stop. Chromium can be told
 * to resize instead (`interactive-widget` in index.html); Safari cannot.
 *
 * So while a field has focus and the visual viewport is meaningfully shorter than
 * the layout one, this writes the visual height to `--vvh`, which the shell uses
 * as its height, and puts the page back at the top. `data-keyboard` on the root
 * drops the home-indicator inset, which Safari keeps reporting under the keyboard.
 * Everywhere the two viewports agree — a desktop, Chromium with the resize hint —
 * nothing is written and the shell is `100dvh`.
 *
 * A pinch-zoom also shrinks the visual viewport, and is left alone: scrolling a
 * zoomed page back to the top would fight the person panning it.
 */
export function useVisualViewport(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    let frame = 0;

    const apply = () => {
      frame = 0;
      const covered = window.innerHeight - vv.height;
      const open =
        vv.scale <= 1.01 && covered > KEYBOARD_MIN_PX && isEditable(document.activeElement);
      if (open) {
        root.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
        root.dataset.keyboard = '';
        if (window.scrollY !== 0 || vv.offsetTop !== 0) window.scrollTo(0, 0);
      } else if ('keyboard' in root.dataset) {
        root.style.removeProperty('--vvh');
        delete root.dataset.keyboard;
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    vv.addEventListener('resize', schedule);
    vv.addEventListener('scroll', schedule);
    document.addEventListener('focusin', schedule);
    document.addEventListener('focusout', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      vv.removeEventListener('resize', schedule);
      vv.removeEventListener('scroll', schedule);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
      root.style.removeProperty('--vvh');
      delete root.dataset.keyboard;
    };
  }, []);
}

/** Smaller than any phone keyboard, larger than Safari's toolbar collapsing. */
const KEYBOARD_MIN_PX = 120;

function isEditable(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly;
  if (el instanceof HTMLInputElement) {
    return !el.readOnly && !NON_TEXT_INPUTS.has(el.type);
  }
  return el instanceof HTMLElement && el.isContentEditable;
}

const NON_TEXT_INPUTS = new Set([
  'button',
  'checkbox',
  'color',
  'file',
  'hidden',
  'image',
  'radio',
  'range',
  'reset',
  'submit',
]);
