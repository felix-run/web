import {
  fileRefUrl,
  type ImageAttachment,
  MAX_UPLOAD_BYTES,
  splitFileRef,
  UPLOADABLE_IMAGE_TYPES,
} from '@felix/protocol';
import { getFile, uploadFile } from '@/api';

/**
 * Images go to the harness as stored uploads, not inline.
 *
 * Inline, an image was a `data:` URL in the message, which the harness saves into
 * the session log and re-sends to the model on every later turn of the thread —
 * a screenshot attached once was paid for on each reply after it. And the API's
 * 1 MiB body limit refused anything over roughly 750 KB outright, while the
 * composer advertised 10 MB. An upload is referenced as `felix-file://<id>`, and
 * the harness fetches the bytes once per model call.
 */

/** Longest edge a re-encoded image is drawn at before it is shrunk further. */
const MAX_EDGE = 2048;

/**
 * A failure with a sentence of its own. `detail` keeps the raw response for the
 * operator who needs the status, the way `describeError` does.
 */
export class ImageUploadError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
  }
}

/**
 * The upload statuses whose meaning is specific to `/files`. The shared
 * translator reads every 409 as a decision someone else already made — right for
 * an approval, and exactly wrong here, where it told the operator the image was
 * "no longer pending" when the tenant's storage was full. Everything else
 * (401, 403, 404, 5xx, offline) is left to it.
 */
function explainUpload(err: unknown, filename: string): ImageUploadError | null {
  const raw = String((err as Error)?.message ?? err);
  const status = Number(/:\s*(\d{3})\b/.exec(raw)?.[1]);
  if (status === 409) {
    return new ImageUploadError(
      'Image storage on this harness is full, so the image was not sent. An operator can raise FELIX_ATTACHMENTS_MAX_BYTES_PER_TENANT or wait for the retention sweep.',
      raw,
    );
  }
  if (status === 503) {
    return new ImageUploadError(
      'This harness has no object store configured, so it cannot take images.',
      raw,
    );
  }
  if (status === 400) {
    return new ImageUploadError(`The harness refused ${filename}.`, raw);
  }
  return null;
}

const base64Bytes = (b64: string) =>
  Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);

function splitDataUrl(url: string): { mediaType: string; data: string } | null {
  const m = /^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/s.exec(url);
  return m?.[1] && m[2] !== undefined ? { mediaType: m[1], data: m[2] } : null;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
  return url.slice(url.indexOf(',') + 1);
}

function encode(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Bytes the harness will take: one of its four types, at most `MAX_UPLOAD_BYTES`.
 *
 * An image already within both is sent untouched. Anything else is redrawn and
 * re-encoded, shrinking until it fits — WebP where the browser can encode it,
 * which keeps transparency, else JPEG on white. A GIF over the limit is refused
 * rather than redrawn: a canvas keeps its first frame, and an animation silently
 * becoming a still is not what anyone attached.
 */
export async function fitImage(
  dataUrl: string,
  filename = 'image',
): Promise<{ data: string; mediaType: string }> {
  const parsed = splitDataUrl(dataUrl);
  if (!parsed) throw new ImageUploadError(`${filename} could not be read.`);
  const allowed = (UPLOADABLE_IMAGE_TYPES as readonly string[]).includes(parsed.mediaType);
  if (allowed && base64Bytes(parsed.data) <= MAX_UPLOAD_BYTES) return parsed;
  if (parsed.mediaType === 'image/gif') {
    throw new ImageUploadError(
      `${filename} is a GIF over ${MAX_UPLOAD_BYTES / 1024} KB. Shrinking it would drop the animation, so it was not sent.`,
    );
  }

  const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob()).catch(() => null);
  if (!bitmap) throw new ImageUploadError(`${filename} is not an image this browser can open.`);
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new ImageUploadError('This browser cannot resize images.');

  let scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  for (let attempt = 0; attempt < 8; attempt++) {
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    let blob = await encode(canvas, 'image/webp', 0.85);
    // A browser that cannot encode WebP hands back a PNG instead, without saying so.
    if (!blob || blob.type !== 'image/webp') {
      ctx.globalCompositeOperation = 'destination-over';
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = 'source-over';
      blob = await encode(canvas, 'image/jpeg', 0.85);
    }
    if (blob && blob.size <= MAX_UPLOAD_BYTES) {
      bitmap.close();
      return { data: await blobToBase64(blob), mediaType: blob.type };
    }
    scale *= 0.75;
  }
  bitmap.close();
  throw new ImageUploadError(`${filename} could not be made small enough to send.`);
}

/** Drawn images by file id, so a reference is fetched at most once per tab. */
const drawn = new Map<string, Promise<string | null>>();

/**
 * Upload what the composer holds and return the references to send.
 *
 * Each image is also remembered under its new id with the bytes already in hand,
 * so the turn it appears in draws immediately instead of fetching back what it
 * just sent.
 */
export async function uploadImages(
  files: ReadonlyArray<{ url: string; mediaType: string; filename?: string }>,
): Promise<ImageAttachment[]> {
  const out: ImageAttachment[] = [];
  for (const f of files) {
    const fitted = await fitImage(f.url, f.filename);
    const stored = await uploadFile({
      data: fitted.data,
      mediaType: fitted.mediaType,
      ...(f.filename ? { filename: f.filename } : {}),
    }).catch((err: unknown) => {
      throw explainUpload(err, f.filename ?? 'the image') ?? err;
    });
    drawn.set(stored.fileId, Promise.resolve(`data:${fitted.mediaType};base64,${fitted.data}`));
    out.push({
      url: fileRefUrl(stored.fileId),
      media_type: stored.mediaType,
      ...(f.filename ? { filename: f.filename } : {}),
    });
  }
  return out;
}

/**
 * Something an `<img>` can draw for an attachment URL. A reference is fetched
 * from `GET /files/{id}`; anything else is already drawable. `null` when the
 * upload is gone — deleted, swept by retention, or another deployment's id.
 */
export function drawableUrl(url: string): Promise<string | null> | string {
  const id = splitFileRef(url);
  if (!id) return url;
  let pending = drawn.get(id);
  if (!pending) {
    pending = getFile(id)
      .then((f) => (f.mediaType ? `data:${f.mediaType};base64,${f.data}` : null))
      .catch(() => {
        // Not cached: a failed fetch may be the network, and the next mount retries.
        drawn.delete(id);
        return null;
      });
    drawn.set(id, pending);
  }
  return pending;
}
