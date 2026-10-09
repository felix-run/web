import type { SkillVersion } from '@felix/client';
import { useId } from 'react';
import { versionState } from './skill-status';

/**
 * A version as an option names its state — `0.3.0 · draft`, `0.2.0 · live` —
 * because a bare number asked the reader to remember which one was live while
 * choosing what to compare, evaluate or file feedback against.
 */
export function versionOptionLabel(
  v: Pick<SkillVersion, 'status' | 'version' | 'published_at' | 'decided_at'>,
  liveVersion: string | null,
): string {
  return `${v.version} · ${versionState(v, liveVersion)}`;
}

/** Which stored version a tab is looking at — the Gate, Evals and Feedback tabs share it. */
export function VersionPicker({
  versions,
  liveVersion,
  value,
  onChange,
}: {
  versions: SkillVersion[];
  liveVersion: string | null;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center gap-2 text-xs">
      <label htmlFor={id} className="text-muted-foreground">
        Version
      </label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs"
      >
        {versions.map((v) => (
          <option key={v.version} value={v.version}>
            {versionOptionLabel(v, liveVersion)}
          </option>
        ))}
      </select>
    </div>
  );
}
