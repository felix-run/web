// @vitest-environment happy-dom
import type { SkillVersion } from '@felix/client';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import {
  ownReason,
  SourceLabel,
  UpstreamLine,
  VersionProvenance,
} from '../src/components/skills/skill-status';

/**
 * Where a skill version came from, beyond its author: an import from a GitHub source, an
 * operator's adoption of one, a promotion out of someone's personal library, and whether its
 * source has moved on since. These rows were already in the library and the queue, drawn as an
 * unknown source with nothing to say where they came from.
 */

afterEach(cleanup);

const version = (over: Partial<SkillVersion> = {}): SkillVersion => ({
  name: 'pdf',
  version: '0.1.0',
  parent_version: null,
  status: 'draft',
  source: 'import',
  author: 'blake',
  origin_manifest_id: null,
  session_id: null,
  reason: '',
  description: '',
  quality_score: 80,
  security_status: 'pass',
  decided_by: null,
  decision_note: null,
  created_at: 1,
  decided_at: null,
  published_at: null,
  ...over,
});

describe('a version’s provenance', () => {
  it('says where an import came from, and that it still counts as one', () => {
    render(
      <VersionProvenance
        version={version({
          origin_source: 'github:anthropics/skills/pdf',
          origin_ref: 'main',
          origin_commit: 'abcdef1234567890',
          origin_license: 'MIT',
          lineage_import: true,
        })}
      />,
    );
    expect(document.body.textContent).toContain(
      'from github:anthropics/skills/pdf at main (abcdef1) · MIT',
    );
    expect(screen.getByText('import lineage')).toBeTruthy();
  });

  it('says what an adoption and a promotion copied', () => {
    render(<VersionProvenance version={version({ source: 'operator', adopted_from: '0.1.0' })} />);
    expect(document.body.textContent).toContain('adopted from 0.1.0');
    cleanup();
    render(<VersionProvenance version={version({ source: 'promoted', promoted_from: '1.2.0' })} />);
    expect(document.body.textContent).toContain(
      "promoted from 1.2.0 of its author's personal library",
    );
  });

  it('says nothing for a version written here', () => {
    const { container } = render(<VersionProvenance version={version({ source: 'operator' })} />);
    expect(container.textContent).toBe('');
  });

  it('names an imported and a promoted version by what they are', () => {
    render(<SourceLabel source="promoted" author="blake" />);
    expect(screen.getByText('promoted')).toBeTruthy();
  });
});

describe('an imported skill’s source', () => {
  it('says when the source has moved on, and when it can be taken', () => {
    render(
      <UpstreamLine
        upstream={{
          update_available: true,
          upstream_commit: '1234567abc',
          eligible: false,
          eligible_at: 1_800_000_000_000,
        }}
      />,
    );
    expect(document.body.textContent).toContain(
      'Its source has changed since the newest version (1234567)',
    );
    expect(document.body.textContent).toContain('It can be taken from');
  });

  it('says why a check failed', () => {
    render(<UpstreamLine upstream={{ error: 'source_not_found' }} />);
    expect(document.body.textContent).toContain('could not be checked: source_not_found');
  });

  it('says it is up to date, and nothing for a skill never imported', () => {
    render(<UpstreamLine upstream={{ update_available: false }} />);
    expect(document.body.textContent).toContain('Up to date with its source');
    cleanup();
    const { container } = render(<UpstreamLine upstream={null} />);
    expect(container.textContent).toBe('');
  });
});

describe('ownReason', () => {
  const imported = version({
    source: 'import',
    origin_source: 'github:acme/skills/pdf',
    origin_commit: 'dbd4588f9e1033efb41dad4bef2f7947c8993d44',
  });

  it('leaves out a reason that only restates where an import came from', () => {
    expect(
      ownReason({
        ...imported,
        reason: 'imported from github:acme/skills/pdf@dbd4588f9e1033efb41dad4bef2f7947c8993d44',
      }),
    ).toBeNull();
    expect(
      ownReason({
        ...imported,
        reason: 'updated from github:acme/skills/pdf@dbd4588f9e1033efb41dad4bef2f7947c8993d44',
      }),
    ).toBeNull();
  });

  it('keeps a reason someone wrote, and one naming a different source or commit', () => {
    expect(ownReason({ ...imported, reason: 'the team asked for forms' })).toBe(
      'the team asked for forms',
    );
    expect(ownReason({ ...imported, reason: 'imported from github:acme/skills/pdf@0000' })).toBe(
      'imported from github:acme/skills/pdf@0000',
    );
    expect(ownReason({ ...version({}), reason: '' })).toBeNull();
  });
});
