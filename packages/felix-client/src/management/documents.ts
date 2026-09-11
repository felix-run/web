/**
 * The document corpus an agent retrieves from (`/documents`).
 *
 * The same argument `/memory` makes, one level up: an agent answering from a
 * corpus is only as trustworthy as the corpus, so whoever runs it has to be able
 * to see what is in there, find the chunk behind a bad answer, and remove it
 * without a database console. The harness says so in as many words and built
 * this to `/memory`'s shape on purpose.
 *
 * Two differences from `/memory` matter at the call site, and both change what a
 * UI may honestly say:
 *
 * - **Delete is hard.** `/memory` retires a row to `forgotten` and drops it out
 *   of recall; this removes the document and every chunk of it, and answers with
 *   how many went. Say "delete", not "forget".
 * - **Ingest is idempotent on `(source, title)`** — that pair is the document's
 *   identity, so re-sending replaces rather than duplicates. Which also means a
 *   typo'd title is a *new* document rather than a correction.
 *
 * Reads need the `documents:read` scope and writes `documents:write`, so a 403
 * means the key is too narrow rather than that the corpus is empty. These routes
 * are newer than most of the surface, so a 404 means the harness predates them.
 */

import type { FelixHttp } from '../http';

/**
 * Upstream bounds, enforced here too.
 *
 * A 422 for a length the form could have checked is a worse answer than not
 * sending the request, and the text ceiling in particular is worth catching
 * locally: 750k characters is a slow upload to be refused at the end of.
 */
export const DOCUMENT_LIMITS = {
  title: 400,
  source: 2_000,
  text: 750_000,
  /** Serialized `metadata`, in bytes rather than characters. */
  metadataBytes: 16_384,
  maxChars: { min: 128, max: 20_000 },
  overlapChars: { min: 0, max: 4_000 },
} as const;

/** One row from GET /documents. */
export interface DocumentRecord {
  doc_id: string;
  title: string;
  /** Where the text came from. Opaque to the harness, and half the identity. */
  source: string;
  /** How many chunks this document became. */
  chunks: number;
  created_at?: number;
}

/**
 * One hit from GET /documents/search — a *chunk*, not a document, which is the
 * whole point: the answer came from a passage and that passage is what an
 * operator needs to read.
 */
export interface DocumentHit {
  doc_id: string;
  chunk_id: string;
  chunk_index: number;
  title: string;
  source: string;
  content: string;
  score: number;
  /**
   * Which retrievers surfaced this, e.g. `["lexical"]` or
   * `["lexical", "vector"]`.
   *
   * `lexical` alone means the vector channel did not *run* — usually no embedder
   * is configured, which is the harness's default — rather than that it ran and
   * disagreed. Rendering it is the difference between "retrieval is wrong" and
   * "retrieval is half-configured".
   */
  channels?: string[];
}

export function createDocumentsClient(http: FelixHttp) {
  const { chatFetch } = http;

  /** GET /documents → the corpus, newest first. */
  async function listDocuments(opts: { limit?: number } = {}): Promise<DocumentRecord[]> {
    const q = new URLSearchParams({ limit: String(opts.limit ?? 100) });
    const res = await chatFetch(`/documents?${q}`);
    if (!res.ok) throw new Error(`documents: ${res.status}`);
    const body = (await res.json()) as { items?: DocumentRecord[] };
    return body.items ?? [];
  }

  /**
   * GET /documents/search → hybrid retrieval, with the channel behind each hit.
   *
   * The same reproducibility argument as `/memory/search`: an operator can ask
   * what the agent would have retrieved, and see which retriever produced it.
   */
  async function searchDocuments(
    query: string,
    opts: { limit?: number } = {},
  ): Promise<DocumentHit[]> {
    const q = new URLSearchParams({ q: query, limit: String(opts.limit ?? 5) });
    const res = await chatFetch(`/documents/search?${q}`);
    if (!res.ok) throw new Error(`documents/search: ${res.status}`);
    const body = (await res.json()) as { items?: DocumentHit[] };
    return body.items ?? [];
  }

  /**
   * POST /documents → ingest or replace one document.
   *
   * Everything the model later retrieves passes through here, so this is an
   * injection ingress in exactly the way `POST /memory` is — text an operator
   * puts in front of the model, from a store it will read back without the
   * provenance of a tool result. A UI should say so rather than present it as an
   * upload box.
   *
   * A 409 means the tenant's corpus ceiling is reached, and it is only checked
   * for a document that is not already there — re-ingesting something the corpus
   * already holds is never refused for a limit it is not adding to.
   */
  async function addDocument(input: {
    title: string;
    text: string;
    source?: string;
    metadata?: Record<string, unknown>;
    /** Chunk size and overlap, in characters. Omitted means the harness's own. */
    maxChars?: number;
    overlapChars?: number;
  }): Promise<{ doc_id: string; chunks: number }> {
    const res = await chatFetch('/documents', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        title: input.title,
        source: input.source ?? '',
        text: input.text,
        metadata: input.metadata ?? {},
        // Omitted rather than defaulted: the route's own defaults are the
        // chunker's, and restating them here would pin this client to a number
        // the harness is free to retune.
        ...(input.maxChars === undefined ? {} : { max_chars: input.maxChars }),
        ...(input.overlapChars === undefined ? {} : { overlap_chars: input.overlapChars }),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`documents/add: ${res.status} ${detail.slice(0, 200)}`);
    }
    return (await res.json()) as { doc_id: string; chunks: number };
  }

  /**
   * DELETE /documents/{doc_id} → remove the document and every chunk of it.
   *
   * Hard, unlike `/memory`'s forget. Answers with the number of chunks removed,
   * which is worth showing: it is the only confirmation that the thing deleted
   * was the size the listing claimed.
   */
  async function deleteDocument(docId: string): Promise<{ removed_chunks: number }> {
    const res = await chatFetch(`/documents/${encodeURIComponent(docId)}`, { method: 'DELETE' });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`documents/delete: ${res.status} ${detail.slice(0, 200)}`);
    }
    return (await res.json()) as { removed_chunks: number };
  }

  return { listDocuments, searchDocuments, addDocument, deleteDocument };
}
