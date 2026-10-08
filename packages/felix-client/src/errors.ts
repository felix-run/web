/**
 * Turn a thrown API error into something worth showing a person.
 *
 * The transport throws `` `${route}: ${status}` `` because that is the right thing for a
 * log and for the developer reading a stack. It is the wrong thing for a panel: an
 * operator reading "audit: 500" learns neither what failed nor what to do, and
 * anyone watching over their shoulder learns nothing at all. Translation happens
 * here, at the boundary where the string becomes copy, so the throw sites stay
 * precise and there is one place to change the wording.
 *
 * The raw text is kept as `detail` rather than discarded: when the plain-language
 * line is not enough, the status code is what makes a bug report actionable.
 */
export interface DescribedError {
  /** Plain-language sentence naming what failed and, where possible, what to do. */
  message: string;
  /** The original error text, for the operator who needs the status code. */
  detail: string;
}

/**
 * A driving request the harness refused because this client is not the thread's
 * driver: the `X-Felix-Lease-Token` it presented was an observer's
 * (`lease_read_only`), or another holder has the thread (`lease_held`).
 *
 * Not a failure to report as one. The client is watching; it should say so and
 * stop offering to drive, not raise an error toast. The message keeps the
 * transport's `route: status code` spelling for logs.
 */
export class LeaseRefusedError extends Error {
  readonly code: 'lease_read_only' | 'lease_held';
  readonly threadId: string;
  constructor(route: string, threadId: string, code: 'lease_read_only' | 'lease_held') {
    super(`${route}: 409 ${code}`);
    this.name = 'LeaseRefusedError';
    this.code = code;
    this.threadId = threadId;
  }
}

export function isLeaseRefusal(err: unknown): err is LeaseRefusedError {
  return err instanceof LeaseRefusedError;
}

/**
 * `POST /chat/stream` refused a resend under an `Idempotency-Key` whose first
 * request is still streaming (`409 idempotency_in_progress`). Nothing ran for
 * this request; the first one's turn is the one to watch, and
 * `GET /chat/stream/{thread_id}` reattaches to it.
 */
export class StreamInProgressError extends Error {
  readonly threadId: string;
  constructor(threadId: string) {
    super('chat/stream: 409 idempotency_in_progress');
    this.name = 'StreamInProgressError';
    this.threadId = threadId;
  }
}

/**
 * The thread already has a durable run in flight, so the harness refused to start
 * another beside it (`409 run_in_progress:<resume_token>`, felix-run/felix#529). Nothing
 * ran and the message never landed; `resumeToken` is the run to watch instead. Two runs
 * on one thread each re-did what the other was doing, which is why this is refused.
 */
export class RunInProgressError extends Error {
  readonly resumeToken: string;
  constructor(route: string, resumeToken: string) {
    super(`${route}: 409 run_in_progress`);
    this.name = 'RunInProgressError';
    this.resumeToken = resumeToken;
  }
}

/**
 * `POST /chat/stream` refused an `Idempotency-Key` it had already seen with a
 * different body (`422 idempotency_key_reused`). Nothing ran, and the key can
 * never send this body: a resend has to go out as a new message, under a new key.
 */
export class IdempotencyKeyReusedError extends Error {
  constructor() {
    super('chat/stream: 422 idempotency_key_reused');
    this.name = 'IdempotencyKeyReusedError';
  }
}

/** A network-layer failure, i.e. the request never reached the harness at all. */
function isOffline(err: unknown): boolean {
  // fetch() rejects with a TypeError when DNS, TLS or the connection itself fails.
  return err instanceof TypeError || /failed to fetch|networkerror|load failed/i.test(String(err));
}

function statusOf(text: string): number | null {
  // Throw sites are `route: 500` or `route: 500 <body excerpt>`.
  const m = text.match(/:\s*(\d{3})\b/);
  return m ? Number(m[1]) : null;
}

/**
 * @param err   whatever was caught
 * @param doing what the user was trying to do, as a verb phrase that completes
 *              "Could not …", e.g. `"load recent activity"`
 */
export function describeError(err: unknown, doing: string): DescribedError {
  const detail = String((err as Error)?.message ?? err);

  if (isLeaseRefusal(err)) {
    return {
      message: `Could not ${doing}: another tab or client is driving this conversation, so this one is watching read-only.`,
      detail,
    };
  }

  if (isOffline(err)) {
    return {
      message: `Could not reach the Felix harness to ${doing}. Check that it is running and that this page points at the right origin.`,
      detail,
    };
  }

  const status = statusOf(detail);
  switch (status) {
    case 401:
      return { message: 'Your access key was rejected. Enter it again to continue.', detail };
    case 403:
      return {
        message: `This key is not allowed to ${doing}. It needs a broader scope on the harness.`,
        detail,
      };
    case 404:
      return {
        // Named, like the others: "no route for this" leaves the operator guessing
        // which of several actions on screen just failed.
        message: `The harness has no route to ${doing}. It is probably running an older version than this client expects.`,
        detail,
      };
    case 409:
      return {
        message: `Could not ${doing}: something else already changed it, so this is no longer pending.`,
        detail,
      };
    case 429:
      return { message: 'The harness is rate limiting requests. Try again in a moment.', detail };
    default:
      if (status && status >= 500) {
        return {
          message: `The harness failed while trying to ${doing}. This is usually transient, so it is worth retrying.`,
          detail,
        };
      }
      if (status && status >= 400) {
        return { message: `The harness rejected the request to ${doing}.`, detail };
      }
      return { message: `Could not ${doing}.`, detail };
  }
}
