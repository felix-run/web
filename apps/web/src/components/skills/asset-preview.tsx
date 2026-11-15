import {
  base64DecodedSize,
  binaryAssetMimeType,
  isValidBase64,
  PREVIEWABLE_IMAGE_TYPES,
} from '@felix/skill-format';
import { Button } from '@felix/ui/button';
import { FileIcon } from 'lucide-react';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * The `data:` URL an asset may be shown through, or null.
 *
 * Only for a raster image type on the allowlist — the harness's own table, which
 * has no SVG and no HTML on it — and only when the bytes are well-formed base64.
 * An agent writes these files, and an SVG drawn through `<img>` is still markup
 * the browser parses; a type the allowlist does not name is shown as a file
 * card instead. `contentType` is what the harness said the file is; when it is
 * given it must agree with the path's own type, so neither can talk the other
 * into a preview.
 */
export function assetDataUrl(path: string, base64: string, contentType?: string): string | null {
  const mime = binaryAssetMimeType(path);
  if (!PREVIEWABLE_IMAGE_TYPES.has(mime)) return null;
  if (contentType !== undefined && contentType.split(';')[0]?.trim() !== mime) return null;
  if (!isValidBase64(base64)) return null;
  return `data:${mime};base64,${base64}`;
}

/** A binary bundle asset: an image preview where one is safe, a file card otherwise. */
export function AssetPreview({
  path,
  base64Content,
  contentType,
  onReplace,
}: {
  path: string;
  base64Content: string;
  contentType?: string;
  onReplace?: () => void;
}) {
  const src = assetDataUrl(path, base64Content, contentType);
  const mime = contentType ?? binaryAssetMimeType(path);
  const size = isValidBase64(base64Content)
    ? formatBytes(base64DecodedSize(base64Content))
    : 'not valid base64';
  return (
    <div className="flex flex-col items-center gap-3 p-6 text-center">
      {src ? (
        <img
          src={src}
          alt={path}
          className="max-h-64 max-w-full rounded-md border border-border/60 object-contain"
        />
      ) : (
        <div className="flex size-24 flex-col items-center justify-center gap-1 rounded-md bg-muted text-xs text-muted-foreground">
          <FileIcon aria-hidden className="size-5" />
          <span className="font-mono">{mime.split('/')[1] ?? 'file'}</span>
        </div>
      )}
      <p className="font-mono text-xs text-muted-foreground">
        {path} · {size}
      </p>
      {!src && (
        <p className="text-xs text-muted-foreground">
          Not previewed: only raster images are shown.
        </p>
      )}
      {onReplace && (
        <Button type="button" variant="outline" size="sm" onClick={onReplace}>
          Replace
        </Button>
      )}
    </div>
  );
}
