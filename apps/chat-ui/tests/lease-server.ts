import { vi } from 'vitest';

/**
 * A harness that answers leases the way `felix/session/lease.py` does since
 * `felix-run/felix#479` — not a stub that says 200 to everything, which is how a
 * release with the wrong token went unnoticed: the real one 403s it.
 *
 * One exclusive hold and any number of observer holds per thread, each with its
 * own token. A renewal proves itself with the hold's token; a release needs one;
 * observers never block an exclusive acquire and are never promoted. The routes
 * that drive a thread honour `X-Felix-Lease-Token` exactly as `_refuse_unless_driver`
 * does. Expiry is not modelled: nothing here lives long enough to lapse.
 *
 * Every request can be held in flight for a while before the "server" acts on
 * it, which is the reordering a real network does and the only way the races
 * show up.
 */

export interface Lease {
  holder: string | null;
  token: string | null;
  /** Observer holder id → that observer's own token. */
  observers: Map<string, string>;
  readonly mode: 'exclusive' | 'shared';
}

export interface Call {
  route: 'acquire' | 'release';
  thread: string;
  status: number;
  token?: string;
  mode?: string;
  holder?: string;
}

/** A request to a route that drives the thread, with the lease header it carried. */
export interface Drive {
  method: string;
  path: string;
  thread: string | undefined;
  leaseToken: string | undefined;
  status: number;
}

/** The routes `routes/chat.py` guards with `_refuse_unless_driver`, as the proxy sees them. */
const DRIVING: Array<[string, RegExp]> = [
  ['POST', /^\/api\/chat\/?$/],
  ['POST', /^\/api\/chat\/stream$/],
  ['POST', /^\/api\/chat\/(continue|abort|rewind|steer|tool_result|ui|thinking|compact)$/],
  ['POST', /^\/api\/chat\/sessions\/(custom|name|label)$/],
  ['DELETE', /^\/api\/chat\/history\/[^/]+$/],
];

function newLease(): Lease {
  return {
    holder: null,
    token: null,
    observers: new Map(),
    get mode() {
      return this.holder ? 'exclusive' : 'shared';
    },
  };
}

/** A `/chat/stream` POST as it reached the server, for a `stream` answer to look at. */
export interface StreamRequest {
  headers: Record<string, string>;
  body: string;
}

export function leaseServer(
  opts: {
    /** Answers `/chat/stream`; throwing stands in for a request that never got an answer. */
    stream?: (req: StreamRequest) => Response | Promise<Response>;
    sessions?: Array<{ id: string; sessionName?: string }>;
    /**
     * Runs as a driving request arrives, before its token is checked — the one
     * point where a test can change the lease with no renewal tick able to see
     * it first.
     */
    beforeDrive?: (drive: { method: string; path: string; thread: string | undefined }) => void;
  } = {},
) {
  const leases = new Map<string, Lease>();
  const calls: Call[] = [];
  const drives: Drive[] = [];
  /** Per route, how long the next requests sit on the wire before the server acts. */
  const delays: Record<Call['route'], number[]> = { acquire: [], release: [] };
  let minted = 0;
  const mint = () => `tok-${++minted}`;

  const prune = (thread: string) => {
    const lease = leases.get(thread);
    if (lease && !lease.holder && lease.observers.size === 0) leases.delete(thread);
  };

  function acquire(b: Record<string, string>): [number, unknown] {
    const lease = leases.get(b.thread_id) ?? newLease();
    const observer = lease.observers.get(b.holder_id);
    const refused: [number, unknown] = [409, { detail: 'lease_held' }];
    let granted: string;
    let renewed: boolean;
    let heldByOther = false;
    if (b.mode !== 'shared') {
      if (lease.holder) {
        if (lease.holder !== b.holder_id || !b.token || b.token !== lease.token) return refused;
        renewed = true;
      } else {
        if (observer !== undefined && b.token && b.token === observer) {
          lease.observers.delete(b.holder_id);
        }
        lease.holder = b.holder_id;
        lease.token = b.token || mint();
        renewed = false;
      }
      granted = lease.token as string;
    } else if (lease.holder && lease.holder === b.holder_id && b.token && b.token === lease.token) {
      lease.observers.set(b.holder_id, lease.token);
      lease.holder = null;
      lease.token = null;
      granted = lease.observers.get(b.holder_id) as string;
      renewed = true;
    } else {
      if (observer !== undefined) {
        if (!b.token || b.token !== observer) return refused;
        renewed = true;
        granted = observer;
      } else {
        renewed = false;
        granted = mint();
      }
      lease.observers.set(b.holder_id, granted);
      heldByOther = Boolean(lease.holder);
    }
    leases.set(b.thread_id, lease);
    return [
      200,
      {
        ok: true,
        renewed,
        token: granted,
        mode: b.mode === 'shared' ? 'shared' : 'exclusive',
        held_by_other: heldByOther,
      },
    ];
  }

  function release(b: Record<string, string>): [number, unknown] {
    const lease = leases.get(b.thread_id);
    if (!lease) return [200, { ok: true, released: false }];
    if (!b.token) return [403, { detail: 'token_required' }];
    let target: string | undefined;
    let exclusive = false;
    if (lease.holder && b.token === lease.token) {
      target = lease.holder;
      exclusive = true;
    } else {
      target = [...lease.observers].find(([, t]) => t && t === b.token)?.[0];
    }
    if (!target) return [403, { detail: 'token_mismatch' }];
    if (b.holder_id && b.holder_id !== target) return [403, { detail: 'token_mismatch' }];
    if (exclusive) {
      lease.holder = null;
      lease.token = null;
    } else {
      lease.observers.delete(target);
    }
    prune(b.thread_id);
    return [200, { ok: true, released: true }];
  }

  function writeRefusal(thread: string, token: string): string | null {
    const lease = leases.get(thread);
    if (!lease) return null;
    if (lease.holder && token === lease.token) return null;
    if ([...lease.observers.values()].includes(token)) return 'lease_read_only';
    if (lease.holder) return 'lease_held';
    return null;
  }

  function status(thread: string) {
    const lease = leases.get(thread);
    return {
      locked: Boolean(lease?.holder),
      attached: Boolean(lease),
      holder_id: lease?.holder ?? null,
      mode: lease ? lease.mode : null,
      observers: lease?.observers.size ?? 0,
      observer_holds: [...(lease?.observers.keys() ?? [])].map((h) => ({
        holder_id: h,
        expires_at: 0,
      })),
      expires_at: null,
      token_hint: lease?.token?.slice(0, 6) ?? null,
    };
  }

  const requests: string[] = [];
  /** Every release as it left the page — headers and `keepalive` included. */
  const releaseInits: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = vi.fn(async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    requests.push(`${method} ${url} ${String(init?.body ?? '')}`);
    if (url.endsWith('/chat/sessions/lease/release')) releaseInits.push({ url, init: init ?? {} });
    const route = url.endsWith('/chat/sessions/lease/release')
      ? 'release'
      : url.endsWith('/chat/sessions/lease')
        ? 'acquire'
        : null;
    if (route) {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, string>;
      const wait = delays[route].shift() ?? 0;
      if (wait) await new Promise((r) => setTimeout(r, wait));
      const [code, payload] = route === 'acquire' ? acquire(body) : release(body);
      calls.push({
        route,
        thread: body.thread_id ?? '',
        status: code,
        token: body.token,
        mode: body.mode,
        holder: body.holder_id,
      });
      return new Response(JSON.stringify(payload), { status: code });
    }
    const leaseStatus = url.match(/\/chat\/sessions\/([^/?]+)\/lease$/);
    if (leaseStatus && method === 'GET') {
      return new Response(JSON.stringify(status(decodeURIComponent(leaseStatus[1] ?? ''))), {
        status: 200,
      });
    }
    const path = url.split('?')[0] ?? url;
    if (DRIVING.some(([m, re]) => m === method && re.test(path))) {
      const headers = (init?.headers ?? {}) as Record<string, string>;
      const leaseToken = headers['x-felix-lease-token'];
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      const thread =
        typeof body.thread_id === 'string'
          ? body.thread_id
          : method === 'DELETE'
            ? decodeURIComponent(path.split('/').pop() ?? '')
            : undefined;
      opts.beforeDrive?.({ method, path, thread });
      const refusal = thread && leaseToken ? writeRefusal(thread, leaseToken) : null;
      drives.push({ method, path, thread, leaseToken, status: refusal ? 409 : 200 });
      if (refusal) return new Response(JSON.stringify({ detail: refusal }), { status: 409 });
    }
    if (url.includes('/chat/stream') && method === 'POST') {
      const req: StreamRequest = {
        headers: (init?.headers ?? {}) as Record<string, string>,
        body: String(init?.body ?? ''),
      };
      return (
        (await opts.stream?.(req)) ??
        new Response('data: [DONE]\n\n', {
          status: 200,
          headers: { 'content-type': 'text/event-stream' },
        })
      );
    }
    if (url.includes('/chat/sessions')) {
      const sessions = opts.sessions ?? [];
      return new Response(JSON.stringify({ sessions, items: sessions }), { status: 200 });
    }
    if (url.includes('/approvals')) {
      return new Response(JSON.stringify({ requests: [] }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  });
  vi.stubGlobal('fetch', fetchFn);

  /** Another client takes the thread exclusively, as a first tab would. */
  const holdElsewhere = (thread: string, holder = 'other-tab') =>
    acquire({ thread_id: thread, holder_id: holder, mode: 'exclusive' });
  /** That client leaves: its exclusive hold is released with its own token. */
  const leave = (thread: string) => {
    const lease = leases.get(thread);
    if (!lease?.token) return;
    release({ thread_id: thread, token: lease.token });
  };

  return { leases, calls, delays, requests, releaseInits, drives, holdElsewhere, leave };
}
