/**
 * Split shell for the access-key screen: a quiet brand panel on the left, the
 * form on the right. Ported from the sibling felix.run client, minus its
 * geo-keyed photo hero — that pulled a Cloudflare `request.cf` lookup and a
 * hot-linked CDN image into a screen that renders before the app is usable.
 * The panel is painted from this app's own tokens instead, so the gate makes
 * no network request of its own.
 *
 * The split lands at `lg`, not `md`: at tablet widths the panel squeezes the
 * form column narrower than its own `max-w-sm` and both halves read cramped.
 */

import type { ReactNode } from 'react';

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
        className="relative hidden overflow-hidden border-r border-border/60 bg-gradient-to-br from-muted to-background lg:block"
      >
        <div className="flex h-full flex-col justify-between p-8">
          <span className="text-sm font-semibold uppercase tracking-wider">Felix</span>

          <div className="max-w-lg space-y-2">
            <h2 className="text-balance text-2xl font-semibold tracking-tight">
              Chat and inspect a self-hosted Felix harness.
            </h2>
            <p className="text-pretty text-sm text-muted-foreground">
              Streaming transcript, tool cards, approvals, memory, audit and manifests — one
              operator surface over the harness API.
            </p>
          </div>

          <p className="text-xs text-muted-foreground">
            Access is gated by a shared key, not a user account.
          </p>
        </div>
      </aside>

      <div className="flex items-center justify-center p-6">{children}</div>
    </div>
  );
}
