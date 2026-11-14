/**
 * Split shell for the access-key screen: a quiet brand panel on the left, the
 * form on the right. Ported from the sibling felix.run client, minus its
 * geo-keyed photo hero — that pulled a Cloudflare `request.cf` lookup and a
 * hot-linked CDN image into a screen that renders before the app is usable.
 * The panel is painted from this app's own tokens instead, so the gate makes
 * no network request of its own.
 *
 * Flat `ground`, the tone the app's own sidebar carries the same mark on, rather
 * than the `muted` → `background` gradient it arrived with: that was the only
 * gradient in the app, and "a gradient somewhere" is one of the marks of the
 * scaffolded default this surface is meant not to look like. Not `muted`: the two
 * are one value in light, but dark `muted` is the hover wash, a step *above* the
 * sheet, which made an empty panel the brightest thing on the page and the form
 * beside it the dimmest. Muted text measures 5.46:1 on ground light, 7.70:1 dark.
 *
 * The heading is a headline (16px), the top of the type ramp. It was 24px, a
 * size the ramp does not define, on the one screen that renders before the app.
 *
 * The split lands at `lg`, not `md`: at tablet widths the panel squeezes the
 * form column narrower than its own `max-w-sm` and both halves read cramped.
 */

import type { ReactNode } from 'react';
import { BrandMark } from '@/components/brand-mark';

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    // `min-h-svh` rather than `min-h-screen`: `vh` ignores mobile browser
    // chrome, which pushed the centred card far enough down to clip on a
    // phone in portrait.
    <div className="grid min-h-svh w-full grid-cols-1 bg-background lg:grid-cols-2">
      {/*
        Decorative, and `aria-hidden` on purpose: the wordmark here would
        otherwise be the second "Felix" a screen reader meets, the form's
        <h1> being the first and the one that names the page.
      */}
      <aside
        aria-hidden="true"
        className="relative hidden overflow-hidden border-r border-border/60 bg-ground lg:block"
      >
        <div className="flex h-full flex-col justify-between p-8">
          <span className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider">
            <BrandMark className="size-4" />
            Felix
          </span>

          <div className="max-w-lg space-y-2">
            <h2 className="text-balance text-base font-semibold">
              Chat and inspect a self-hosted Felix harness.
            </h2>
            <p className="text-pretty text-sm text-muted-foreground">
              Streaming transcript, tool cards, approvals, memory, audit and manifests — one
              operator surface over the harness API.
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            Who can sign in, and how, is set by whoever runs this harness.
          </p>
        </div>
      </aside>

      {/* 16px at phone width, the app's side gutter: with the card's own 24px inside a 24px
          gutter, a 320px screen left the form 224px to work in. */}
      <div className="flex items-center justify-center p-4 sm:p-6">{children}</div>
    </div>
  );
}
