/**
 * Turn a thrown API error into something worth showing a person.
 *
 * `api.ts` throws `` `${route}: ${status}` `` because that is the right thing for a
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
