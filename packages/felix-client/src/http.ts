/**
 * The credentialed fetch every Felix route goes through, extracted so the chat
 * verbs and the management surface can share one of it rather than two.
 *
 * There are two very different callers and neither is visible from here. A
 * browser cannot reach the harness at all — no CORS, no static assets — so
 * chat-ui points this at its own same-origin `/api` prefix and lets the proxy
 * Worker forward upstream, adding `x-chat-key` on the way out. A terminal
 * client has no such restriction: it points at `FELIX_ORIGIN` and sends
 * `Authorization: Bearer` itself.
 *
 * Route literals stay harness-relative (`/chat/stream`, not `/api/chat/stream`)
 * and these two helpers prepend `baseUrl`. That is also what
 * `scripts/check-api-drift.mjs` reads: it matches the helper *name* followed by
 * a string literal, so a module that renames `chatFetch` on the way in — or
 * builds its path from fragments — silently drops out of the check. Destructure
 * these under their own names and pass literals.
 */

export interface FelixClientOptions {
  /**
   * Everything is appended to this: `/api` for a browser going through the
   * proxy Worker, `http://localhost:8080` for a direct caller. No trailing slash.
   */
  baseUrl: string;
  /** Credentials, read per request so a rotated key takes effect without a rebuild. */
  headers?: () => Record<string, string>;
  /**
   * Whether the harness answered at all — any reply, a 500 included, means
   * something is listening. Only a transport-level rejection is `false`.
   */
  onReachability?: (reachable: boolean) => void;
  /** A 401: the key is missing, wrong, or rotated. */
  onUnauthorized?: () => void;
  /** Injectable for tests and for a runtime whose fetch is not global. */
  fetch?: typeof globalThis.fetch;
}

export interface FelixHttp {
  /** The origin every call is made against, for a client that reports it. */
  baseUrl: string;
  /** A harness call with credentials attached, and 401 reported. */
  chatFetch: (path: string, init?: RequestInit) => Promise<Response>;
  /** The same call without the 401 handling. */
  rawFetch: (path: string, init?: RequestInit) => Promise<Response>;
  /** A response body, bounded, for an error message. */
  detailOf: (res: Response) => Promise<string>;
}

export function createHttp(opts: FelixClientOptions): FelixHttp {
  const doFetch = opts.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const base = opts.baseUrl.replace(/\/+$/, '');
  const auth = () => opts.headers?.() ?? {};

  /**
   * A harness call with credentials attached. A 401 means the key is missing,
   * wrong or rotated — report it before the caller's own error handling runs.
   */
  const chatFetch = async (path: string, init: RequestInit = {}): Promise<Response> => {
    let res: Response;
    try {
      res = await doFetch(base + path, {
        ...init,
        headers: { ...(init.headers as Record<string, string> | undefined), ...auth() },
      });
    } catch (err) {
      // `fetch` rejects only when the request never reached anything: DNS, TLS, a
      // refused connection, a dropped link. That is the one case that means the
      // harness is not there. An abort is the caller changing its mind, not a
      // connectivity fact, so it is left alone.
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        opts.onReachability?.(false);
      }
      throw err;
    }
    // Any reply at all, a 500 included, means something is listening.
    opts.onReachability?.(true);
    if (res.status === 401) opts.onUnauthorized?.();
    return res;
  };

  /**
   * The same call without the 401 handling, for the routes where a 401 means
   * "no server history for you", not "your key is wrong" — running those
   * through `chatFetch` would drop a working key and re-prompt.
   */
  const rawFetch = async (path: string, init: RequestInit = {}): Promise<Response> =>
    doFetch(base + path, {
      ...init,
      headers: { ...(init.headers as Record<string, string> | undefined), ...auth() },
    });

  const detailOf = async (res: Response) => (await res.text().catch(() => '')).slice(0, 200);

  return { baseUrl: base, chatFetch, rawFetch, detailOf };
}
