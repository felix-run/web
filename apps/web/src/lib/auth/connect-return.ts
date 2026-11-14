/**
 * Google's return to the Connections page. The harness sends the browser back with a fragment,
 * `#felix_connect=pending` or `#felix_connect_error=<code>`, and the grant waits in a one-load
 * cookie for `POST /connections/google/finish`.
 *
 * Taken and cleared in one step, before anything is awaited: that cookie works once, so a second
 * finish, from StrictMode's second effect run or a reload, answers `connect_expired` over a
 * connection that just succeeded.
 */

export type ConnectReturn = { kind: 'pending' } | { kind: 'error'; code: string };

export function takeConnectReturn(): ConnectReturn | null {
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const error = params.get('felix_connect_error');
  const pending = params.get('felix_connect') === 'pending';
  if (!error && !pending) return null;
  // The router's own state rides in `history.state`, so it goes back as it was.
  window.history.replaceState(
    window.history.state,
    '',
    window.location.pathname + window.location.search,
  );
  return error ? { kind: 'error', code: error } : { kind: 'pending' };
}

/** What each code means to the person who just came back. */
const RETURN_ERRORS: Record<string, string> = {
  access_denied: 'You declined at Google, so nothing was connected.',
  state_mismatch: 'That return did not match what this browser started. Start connecting again.',
  invalid_grant: 'Google refused the sign-in code. Start connecting again.',
  no_refresh_token:
    'Google sent no lasting access. Remove Felix from your Google account’s third-party access, then connect again.',
  google_unavailable: 'Google could not be reached. Try again in a moment.',
  google_config_error: 'This deployment’s Google setup was refused. Tell whoever runs it.',
  connect_failed: 'Connecting did not finish. Try again.',
};

export function connectReturnError(code: string): string {
  return RETURN_ERRORS[code] ?? 'Connecting did not finish. Try again.';
}
