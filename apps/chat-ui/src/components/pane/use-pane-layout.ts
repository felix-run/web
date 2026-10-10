import { type RefObject, useLayoutEffect, useState } from 'react';

/**
 * The widths the transcript and the side pane each need before they can sit
 * side by side: a reading column, and the instrument's own 22rem. Below their
 * sum the pane is an overlay over the whole sheet instead of squeezing either
 * one — measured on the row they share, not on the viewport, so a collapsed
 * sidebar buys the split back.
 */
export const MAIN_MIN_PX = 384;
export const PANE_MIN_PX = 352;

const SHARE_KEY = 'felix.pane.share';
/** Just under half: the transcript keeps the larger side until someone moves it. */
export const DEFAULT_SHARE = 0.46;

function readShare(): number {
  try {
    const v = Number(localStorage.getItem(SHARE_KEY));
    return Number.isFinite(v) && v > 0 && v < 1 ? v : DEFAULT_SHARE;
  } catch {
    return DEFAULT_SHARE;
  }
}

function writeShare(v: number) {
  try {
    if (v === DEFAULT_SHARE) localStorage.removeItem(SHARE_KEY);
    else localStorage.setItem(SHARE_KEY, v.toFixed(3));
  } catch {
    // Storage blocked: the split lasts for this page.
  }
}

export interface PaneLayout {
  /** Room for both side by side. */
  split: boolean;
  /** The pane's share of the row, clamped so neither side drops below its floor. */
  share: number;
  min: number;
  max: number;
  onChange: (share: number) => void;
  onCommit: (share: number) => void;
  onReset: () => void;
}

/**
 * Where the divider stands. The share is per browser rather than per thread —
 * it is how this screen likes to be divided, not something about a conversation
 * — and the drag itself is held apart from it, so a drag writes to storage once,
 * when it ends.
 */
export function usePaneLayout(row: RefObject<HTMLElement | null>): PaneLayout {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1280 : window.innerWidth,
  );
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    const measure = () => setWidth(el.getBoundingClientRect().width || window.innerWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [row]);

  const [stored, setStored] = useState(readShare);
  const [live, setLive] = useState<number | null>(null);

  const split = width >= MAIN_MIN_PX + PANE_MIN_PX;
  const min = Math.min(PANE_MIN_PX / width, 0.5);
  const max = Math.max(1 - MAIN_MIN_PX / width, min);
  const share = Math.min(max, Math.max(min, live ?? stored));

  return {
    split,
    share,
    min,
    max,
    onChange: setLive,
    onCommit: (v) => {
      setLive(null);
      setStored(v);
      writeShare(v);
    },
    onReset: () => {
      setLive(null);
      setStored(DEFAULT_SHARE);
      writeShare(DEFAULT_SHARE);
    },
  };
}
