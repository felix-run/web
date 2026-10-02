/**
 * What kind of place the app is running in, for the few things that differ.
 *
 * Detection, not preference: each of these decides whether a capability exists
 * at all (an install prompt, a push subscription iOS will accept), never how
 * something looks — that is what media queries are for.
 */

/** Launched from the home screen or as an installed app, not in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * An iPhone, iPad or iPod. An iPad asks for the desktop site by default and so
 * reports itself as a Mac; a Mac with a touch screen is the giveaway, since
 * there is no such Mac.
 */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
