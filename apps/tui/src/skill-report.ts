/**
 * The skill library as text for the pager: what `/skills` and `/skill <name>` show.
 *
 * Read-only on purpose. Deciding a draft is the web client's: its publish confirm states the
 * gate's verdict and the live version it replaces before it asks, and the terminal has no room
 * for that question beside a conversation. What a terminal user needs is to *see* what is waiting
 * and why the gate says what it says, without leaving the session — the same reason the
 * inspector's audit and usage sections exist.
 *
 * Plain text rather than a panel: the inspector's eight tabs already fill eighty columns, and a
 * pager scrolls, searches and copies without this client building any of it.
 */

import type {
  ReviewQueueItem,
  SkillDetail,
  SkillPreview,
  SkillSummary,
  SkillVersion,
} from '@felix/client';

/** A harness timestamp, which arrives as seconds or milliseconds, as `YYYY-MM-DD HH:MM` UTC. */
export function stamp(ts: number | null | undefined): string {
  if (!ts) return '—';
  const ms = ts > 1e12 ? ts : ts * 1000;
  return `${new Date(ms).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/** Where a version came from, in one line: the source, and an import's origin. */
function origin(v: SkillVersion): string {
  if (v.origin_source) {
    const commit = v.origin_commit ? ` (${v.origin_commit.slice(0, 7)})` : '';
    return `${v.source} · ${v.origin_source}${v.origin_ref ? ` at ${v.origin_ref}` : ''}${commit}`;
  }
  if (v.promoted_from) return `${v.source} · from ${v.promoted_from}`;
  return `${v.source} · ${v.author}`;
}

/** The queue, oldest first as the harness lists it, then every skill in use. */
export function skillsOverview(queue: ReviewQueueItem[], skills: SkillSummary[]): string {
  const lines: string[] = ['SKILL LIBRARY', ''];
  lines.push(`Waiting for review (${queue.length})`);
  if (!queue.length) lines.push('  nothing is waiting');
  for (const d of queue) {
    lines.push(
      `  ${d.name} ${d.version}  ${origin(d)}  quality ${d.quality_score} · security ${d.security_status}`,
      `    ${d.live_version ? `replaces live ${d.live_version}` : 'nothing live yet'} · saved ${stamp(d.created_at)}`,
    );
    if (d.reason) lines.push(`    reason: ${d.reason}`);
  }
  // In use, as the web library opens: anything live or with a draft waiting.
  const inUse = skills.filter((s) => s.live_version != null || s.pending_drafts > 0);
  lines.push('', `In use (${inUse.length})`);
  if (!inUse.length) lines.push('  no skill is live or waiting');
  for (const s of inUse) {
    const live = s.live_version ? `live ${s.live_version}` : 'nothing live';
    const waiting = s.pending_drafts ? ` · ${s.pending_drafts} waiting` : '';
    lines.push(`  ${s.name}  ${live}${waiting}`);
  }
  const outOfUse = skills.length - inUse.length;
  if (outOfUse) lines.push('', `${outOfUse} archived — /skill <name> reads any of them`);
  lines.push(
    '',
    '/skill <name> for a skill’s versions and the gate’s verdict on its newest draft.',
  );
  return lines.join('\n');
}

/** One skill: its versions newest first, and what the gate says of the newest draft. */
export function skillReport(detail: SkillDetail, preview: SkillPreview | null): string {
  const lines: string[] = [
    `SKILL ${detail.name}`,
    detail.live_version ? `live ${detail.live_version}` : 'nothing live',
    '',
    'Versions, newest first',
  ];
  for (const v of detail.versions) {
    const decided =
      v.decided_by && v.status !== 'draft'
        ? ` · ${v.status === 'published' ? 'published' : 'decided'} by ${v.decided_by}`
        : '';
    lines.push(
      `  ${v.version.padEnd(8)} ${v.status.padEnd(9)} ${origin(v)}  quality ${v.quality_score} · security ${v.security_status}${decided}`,
    );
    if (v.decision_note) lines.push(`    note: ${v.decision_note}`);
  }
  if (detail.upstream) {
    const u = detail.upstream;
    lines.push(
      '',
      u.update_available
        ? `Its source has moved on since ${stamp(u.checked_at)}: an update would save a new draft.`
        : `Up to date with its source as of ${stamp(u.checked_at)}.`,
    );
  }
  if (preview) {
    lines.push(
      '',
      `The gate on ${preview.version}: ${preview.policy_passes ? 'would let it through' : 'would refuse it'}`,
    );
    for (const r of preview.reasons) lines.push(`  - ${r}`);
    for (const c of preview.review_checks.filter((c) => !c.passed)) {
      lines.push(`  · ${c.label}: ${c.message}`);
    }
    for (const i of preview.security_issues) {
      lines.push(`  ! ${i.severity} ${i.path}: ${i.message}`);
    }
    if (!preview.valid) {
      for (const i of preview.validation_issues) lines.push(`  ✗ ${i.path}: ${i.message}`);
    }
  }
  lines.push('', 'Publish, reject and edit from the web client’s Skills page.');
  return lines.join('\n');
}
