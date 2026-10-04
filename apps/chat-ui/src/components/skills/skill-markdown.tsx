import { isBinaryAssetPath } from '@felix/skill-format';
import {
  type AnchorHTMLAttributes,
  type HTMLAttributes,
  type ImgHTMLAttributes,
  useMemo,
} from 'react';
import { defaultRehypePlugins, Streamdown } from 'streamdown';
import {
  type Components,
  responseComponents,
  responseRemarkPlugins,
} from '@/components/chat/response';
import { cn } from '@/lib/utils';
import { assetDataUrl } from './asset-preview';

/**
 * Skill markdown — a SKILL.md body or a reference file — rendered as the
 * transcript renders an answer, with less trust.
 *
 * It is the chat `Response`'s pipeline (the same remark plugins, the same list
 * components, the renderer's sanitiser) with `rehype-raw` taken *out* — the
 * plugin that lets the transcript's markdown carry inline HTML. A skill is agent-written text that will be read again by every
 * run that activates it, so no HTML in it becomes an element here: without
 * `raw`, an HTML node in the markdown never reaches the DOM.
 *
 * Two elements are ours, because what they point at decides what is safe:
 *
 * - **Links.** A bundle-relative link (`references/api.md`) opens that file in
 *   place rather than resolving against this page's URL and 404ing. Anything
 *   else is an external link only for `http:`, `https:` and `mailto:`, opened in
 *   a new tab with no referrer; every other scheme is shown as text.
 * - **Images.** Only an asset in this bundle is drawn, through `assetDataUrl`'s
 *   allowlist (raster types, never SVG). A remote image is *not* fetched — a
 *   reviewer opening a draft must not be the request an agent's tracking pixel
 *   was waiting for — and is named instead.
 */

// Without `raw` (no HTML becomes an element) and without `harden`, whose job —
// which links and images may load — the two components below do with the
// bundle in hand: harden resolves a relative link against an origin, which is
// exactly the bundle path those components need to see unresolved. The
// sanitiser stays, and strips a `javascript:` href before either sees it.
const rehypePlugins = Object.entries(defaultRehypePlugins)
  .filter(([name]) => name !== 'raw' && name !== 'harden')
  .map(([, plugin]) => plugin);

/** A link or image target as a bundle path, or null when it points elsewhere. */
export function resolveBundlePath(href: string): string | null {
  if (/^[a-z][a-z0-9+.-]*:|^\/\//i.test(href) || href.startsWith('/') || href.startsWith('#')) {
    return null;
  }
  const clean = href.replace(/^\.\//, '').split(/[?#]/)[0] ?? '';
  return clean.length > 0 ? clean : null;
}

const SAFE_SCHEME = /^(https?:|mailto:)/i;

/**
 * Headings on the instrument ramp. The renderer's own run 30/24/20/18px, which
 * over this 13px body put a SKILL.md's `# Title` at display size inside a
 * panel — DESIGN.md keeps everything but the empty thread's welcome at 16px or
 * under. So `#` is a headline (16px), `##` a title (13px semibold), and the
 * rest step down by weight and muting rather than by size.
 */
const HEADING = {
  h1: 'mt-5 mb-2 text-base font-semibold',
  h2: 'mt-5 mb-1.5 text-sm font-semibold',
  h3: 'mt-4 mb-1 text-sm font-medium',
  h4: 'mt-4 mb-1 text-sm font-medium text-muted-foreground',
  h5: 'mt-4 mb-1 text-sm font-medium text-muted-foreground',
  h6: 'mt-4 mb-1 text-sm font-medium text-muted-foreground',
} as const;

type HeadingProps = HTMLAttributes<HTMLHeadingElement> & { node?: unknown };

const headingComponents = Object.fromEntries(
  (Object.keys(HEADING) as (keyof typeof HEADING)[]).map((Tag) => [
    Tag,
    ({ className, node: _node, ...props }: HeadingProps) => (
      <Tag {...props} className={cn(HEADING[Tag], 'first:mt-0', className)} />
    ),
  ]),
) as Pick<Components, keyof typeof HEADING>;

export function SkillMarkdown({
  markdown,
  files,
  onOpenFile,
  className,
}: {
  markdown: string;
  /** The bundle, so relative links and images can resolve inside it. */
  files?: Record<string, string>;
  onOpenFile?: (path: string) => void;
  className?: string;
}) {
  const components = useMemo<Components>(
    () => ({
      ...responseComponents,
      ...headingComponents,
      a: ({
        href,
        children,
        node: _node,
        ...props
      }: AnchorHTMLAttributes<HTMLAnchorElement> & {
        node?: unknown;
      }) => {
        const bundlePath = href ? resolveBundlePath(href) : null;
        // Own keys only: `[x](constructor)` must not find `Object.prototype.constructor`.
        const inBundle = !!bundlePath && !!files && Object.hasOwn(files, bundlePath);
        if (bundlePath && inBundle && onOpenFile) {
          return (
            <button
              type="button"
              onClick={() => onOpenFile(bundlePath)}
              className="cursor-pointer font-medium underline underline-offset-2"
            >
              {children}
            </button>
          );
        }
        // Relative, so it can only mean a bundle file: named rather than linked,
        // since resolved against this page it would point somewhere unrelated.
        if (bundlePath) return <code className="font-mono text-[0.9em]">{children}</code>;
        if (!href || !SAFE_SCHEME.test(href)) return <span>{children}</span>;
        return (
          <a
            {...props}
            href={href}
            target="_blank"
            rel="noreferrer noopener nofollow"
            className="underline underline-offset-2"
          >
            {children}
          </a>
        );
      },
      img: ({ src, alt }: ImgHTMLAttributes<HTMLImageElement> & { node?: unknown }) => {
        const target = typeof src === 'string' ? src : '';
        const bundlePath = resolveBundlePath(target);
        const content =
          bundlePath && files && Object.hasOwn(files, bundlePath) ? files[bundlePath] : undefined;
        const dataUrl =
          bundlePath && content !== undefined && isBinaryAssetPath(bundlePath)
            ? assetDataUrl(bundlePath, content)
            : null;
        if (dataUrl) {
          return <img src={dataUrl} alt={alt ?? bundlePath ?? ''} className="max-w-full" />;
        }
        return (
          <span
            className="font-mono text-xs text-muted-foreground"
            title={
              bundlePath
                ? 'Not in this bundle, or not an image type that is shown'
                : 'Remote images in a skill are not loaded'
            }
          >
            [image: {bundlePath ?? target}]
          </span>
        );
      },
    }),
    [files, onOpenFile],
  );
  return (
    <Streamdown
      className={cn('max-w-none text-sm wrap-break-word', className)}
      components={components}
      remarkPlugins={responseRemarkPlugins}
      rehypePlugins={rehypePlugins}
      parseIncompleteMarkdown={false}
    >
      {markdown}
    </Streamdown>
  );
}
