/*
 * Reading a guide's headings at build time, for the components that link into
 * pages they are not on (FieldIndex, MovedAnchors).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** `src/content/guide`, where every hub page and its folder of children live. */
export const HUB_DIR = join(process.cwd(), 'src/content/guide');

/**
 * GitHub-style heading slug, as Starlight generates it: punctuation goes, `_` and
 * `-` stay. Repeated headings would take a `-1` suffix in Starlight and not here;
 * the pages this reads have none.
 */
export function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/** A page's frontmatter title and the lines after its frontmatter. */
export function readPage(file: string): { title: string; body: string[] } {
  const lines = readFileSync(file, 'utf8').split('\n');
  const end = lines.indexOf('---', 1);
  const titleLine = lines.slice(1, end).find((l) => l.startsWith('title:')) ?? '';
  const title = titleLine.replace(/^title:\s*/, '').replace(/^["']|["']$/g, '');
  return { title, body: lines.slice(end + 1) };
}

/** Every `##`–`######` heading's slug on a page, skipping fenced code. */
export function anchorsOf(body: string[]): string[] {
  const anchors: string[] = [];
  let inFence = false;
  for (const line of body) {
    if (line.startsWith('```')) inFence = !inFence;
    if (inFence) continue;
    const heading = line.match(/^#{2,6}\s+(.*)$/);
    if (heading) anchors.push(slug(heading[1]));
  }
  return anchors;
}
