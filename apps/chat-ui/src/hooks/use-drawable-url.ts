import { useEffect, useState } from 'react';
import { drawableUrl } from '@/lib/image-upload';

/**
 * Something an `<img>` can draw for an image URL: `undefined` while a stored
 * reference is being fetched, `null` when the harness no longer holds it, and
 * the drawable URL otherwise.
 *
 * A `felix-file://` reference is no URL a browser can draw, so it is fetched once
 * (`drawableUrl` caches by id) and drawn from the bytes; an inline URL is drawn
 * as it is, on the first render. Shared by a message's attachments and a tool
 * card's images, which are the same references read from two places.
 */
export function useDrawableUrl(url: string): string | null | undefined {
  const immediate = drawableUrl(url);
  const [src, setSrc] = useState<string | null | undefined>(
    typeof immediate === 'string' ? immediate : undefined,
  );
  useEffect(() => {
    const next = drawableUrl(url);
    if (typeof next === 'string') {
      setSrc(next);
      return;
    }
    let live = true;
    void next.then((resolved) => {
      if (live) setSrc(resolved);
    });
    return () => {
      live = false;
    };
  }, [url]);
  return src;
}
