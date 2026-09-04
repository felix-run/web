/**
 * The harness's management surface — what it *did*, what it *spent*, what it
 * *remembers*, what it *planned*, and the tool outputs too large to inline.
 *
 * This half lived only in `apps/chat-ui/src/api.ts` until now, which made it
 * browser-only by accident rather than by design: a terminal client could drive
 * the whole conversation and then had no way to ask why a run did what it did.
 * Nothing here assumes a browser — the origin and the credentials come from the
 * same `FelixHttp` the chat verbs use.
 *
 * The write surfaces that are genuinely operator-shaped — eval datasets, jobs,
 * manifest versions and the agent card — deliberately stay in chat-ui. Beyond
 * having no second caller, they are reached through `evalFetch`/`jobsFetch`/
 * `manifestFetch`, and `scripts/check-api-drift.mjs` skips those helper
 * *definitions* with a regex spelled for chat-ui's `/api` prefix. Rewritten
 * here they would be extracted as the phantom paths `/eval{}`, `/jobs{}` and
 * `/manifests{}` and fail the drift check against routes that are fine.
 */

import type { FelixHttp } from '../http';
import { createArtifactsClient } from './artifacts';
import { createAuditClient } from './audit';
import { createMemoryClient } from './memory';
import { createPlansClient } from './plans';
import { createUsageClient } from './usage';

export function createManagementClient(http: FelixHttp) {
  return {
    ...createAuditClient(http),
    ...createUsageClient(http),
    ...createMemoryClient(http),
    ...createPlansClient(http),
    ...createArtifactsClient(http),
  };
}
