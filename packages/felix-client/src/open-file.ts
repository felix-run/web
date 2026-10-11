/**
 * `open_file` (felix-run/felix#620): the agent asking a client to show the user a file from the
 * harness's workspace. The harness opens nothing — it checks the file is there and that the
 * pane's `GET /chat/workspace/file` can serve it, and answers with the path. What a client opens
 * is what this reads off that answer, so a refusal (`[tool error/…] …`, never JSON) opens nothing.
 */

export const OPEN_FILE_TOOL = 'open_file';

/** The workspace path a successful `open_file` result names, or null for anything else. */
export function openedPath(output: unknown): string | null {
  let value: unknown = output;
  if (typeof output === 'string') {
    try {
      value = JSON.parse(output);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const { opened, kind } = value as { opened?: unknown; kind?: unknown };
  return typeof opened === 'string' && opened && kind === 'file' ? opened : null;
}
