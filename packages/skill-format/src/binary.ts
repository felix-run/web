/**
 * Binary skill assets (`assets/*.png`, `.pdf`, …) as base64 text.
 *
 * A bundle is a `path → string` map everywhere — validator, review, scan, the
 * wire — so a binary asset travels as base64, symmetric on upload and download.
 * Only the encode/decode here needs to know bytes exist. No `Buffer`, so this
 * runs in a browser, a Worker and Node alike.
 *
 * The table is the harness's (`felix/skills/binary.py`), entry for entry. It is
 * also the only list a page may build a `data:` URL from: an SVG or HTML asset
 * is not on it, so it can never reach the browser as markup.
 */

const BINARY_ASSET_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
};

export const BINARY_ASSET_EXTENSIONS = Object.keys(BINARY_ASSET_MIME_TYPES);

/** The raster image types a preview may render inline. Never SVG: it is markup. */
export const PREVIEWABLE_IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'image/x-icon',
]);

/** 5 MiB decoded, as the harness caps it. */
export const MAX_BINARY_ASSET_BYTES = 5 * 1024 * 1024;

export function isBinaryAssetPath(path: string): boolean {
  const lower = path.toLowerCase();
  return BINARY_ASSET_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function binaryAssetMimeType(path: string): string {
  const lower = path.toLowerCase();
  for (const [ext, mime] of Object.entries(BINARY_ASSET_MIME_TYPES)) {
    if (lower.endsWith(ext)) return mime;
  }
  return 'application/octet-stream';
}

// `String.fromCharCode(...bytes)` on a large asset overflows the call stack.
const CHUNK_SIZE = 8192;

export function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK_SIZE));
  }
  return btoa(binary);
}

export function decodeBase64(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Decoded length without materialising the bytes. Assumes valid, padded base64. */
export function base64DecodedSize(base64: string): number {
  if (base64.length === 0) return 0;
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return (base64.length / 4) * 3 - padding;
}

export function isValidBase64(value: string): boolean {
  return /^[A-Za-z0-9+/]*={0,2}$/.test(value) && value.length % 4 === 0;
}
