/**
 * Stored attachments (`POST /files`), named rather than inlined.
 *
 * A reference rides in the same `url` an inline image uses, as
 * `felix-file://<id>`; the harness swaps it for the bytes immediately before
 * each model call. That is the point of uploading: an inline `data:` URL lands
 * in the session log and is re-sent to the model on every later turn, a
 * reference is fetched per call and costs nothing in the log.
 */
export const FILE_REF_SCHEME = 'felix-file://';

/** What the harness stores, matched against the bytes' own magic numbers. */
export const UPLOADABLE_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
] as const;

/**
 * The largest decoded upload the harness takes (`MAX_ATTACHMENT_BYTES`). It sits
 * under the API's 1 MiB body limit on purpose, so a refusal names the real
 * ceiling rather than arriving as a 413 from the middleware.
 */
export const MAX_UPLOAD_BYTES = 600 * 1024;

export function fileRefUrl(fileId: string): string {
  return `${FILE_REF_SCHEME}${fileId}`;
}

/** The id inside a reference, or `undefined` for any other URL. */
export function splitFileRef(url: string | undefined): string | undefined {
  if (!url?.startsWith(FILE_REF_SCHEME)) return undefined;
  return url.slice(FILE_REF_SCHEME.length) || undefined;
}

/**
 * The image type base64 bytes start with, or `undefined`. The same magic numbers
 * the harness checks an upload against: a stored label is not kept, so the bytes
 * are the only thing that can say what they are.
 */
export function sniffImageType(base64: string): string | undefined {
  if (base64.startsWith('iVBORw0KGgo')) return 'image/png';
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('R0lGODdh') || base64.startsWith('R0lGODlh')) return 'image/gif';
  // RIFF....WEBP: the size bytes sit between the two tags, so decode the header.
  if (base64.startsWith('UklGR')) {
    try {
      return atob(base64.slice(0, 16)).slice(8, 12) === 'WEBP' ? 'image/webp' : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}
