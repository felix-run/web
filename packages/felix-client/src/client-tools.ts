/**
 * The one rule every client-tool executor has to obey.
 *
 * A `tool_request` frame blocks the model loop: the harness parks on a waiter
 * keyed to the call and does not resume until a `tool_result` arrives. So the
 * single outcome an executor must never produce is a promise that neither
 * resolves nor rejects — a directory picker nobody answers, a prompt left on
 * screen, a mount whose permission was revoked mid-call. The conversation would
 * sit there looking like it was still thinking, for the tool's whole timeout.
 *
 * Both the deadline and the abort therefore **resolve** with an error result
 * rather than throwing: the caller posts it upstream and the run continues with
 * the model told what happened.
 */

export interface ClientToolRequest {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export type ClientToolResult = { content: string; error?: boolean };

export const DEFAULT_CLIENT_TOOL_TIMEOUT_MS = 30_000;

export interface ClientToolOptions {
  signal?: AbortSignal;
  /** Overrides {@link DEFAULT_CLIENT_TOOL_TIMEOUT_MS}. */
  timeoutMs?: number;
}

/**
 * Run `work` and always settle, whatever it does.
 *
 * The race does not cancel the underlying work; nothing here is cancellable. It
 * bounds how long the caller waits, which is the property the run needs. Keep
 * the executor's own timeout under the harness's (`spec.client_tools[].
 * timeout_seconds`, default 120s), so the client is the one that reports what
 * went wrong rather than the server reporting a bare timeout.
 */
export async function settleClientTool(
  req: ClientToolRequest,
  work: () => Promise<ClientToolResult>,
  opts: ClientToolOptions = {},
): Promise<ClientToolResult> {
  const { signal, timeoutMs = DEFAULT_CLIENT_TOOL_TIMEOUT_MS } = opts;
  if (signal?.aborted) return { content: `error: ${req.name} aborted`, error: true };

  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  const bail = new Promise<ClientToolResult>((resolve) => {
    timer = setTimeout(
      () => resolve({ content: `error: ${req.name} timed out after ${timeoutMs}ms`, error: true }),
      timeoutMs,
    );
    if (signal) {
      onAbort = () => resolve({ content: `error: ${req.name} aborted`, error: true });
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });

  try {
    return await Promise.race([work(), bail]);
  } finally {
    clearTimeout(timer);
    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
  }
}
