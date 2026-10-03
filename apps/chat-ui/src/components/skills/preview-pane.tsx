import { parseSkillMd } from '@felix/skill-format';
import { useDeferredValue } from 'react';
import { FrontmatterCard } from './frontmatter-card';
import { languageForPath } from './highlight';
import { SkillMarkdown } from './skill-markdown';

/**
 * A markdown file as a run would read it. Deferred, so fast typing never waits
 * on a markdown re-render. Rendered through `SkillMarkdown`, which draws no raw
 * HTML and loads no remote image — the file is agent-written.
 */
export function PreviewPane({
  path,
  content,
  files,
  onOpenFile,
}: {
  path: string;
  content: string;
  files: Record<string, string>;
  onOpenFile?: (path: string) => void;
}) {
  const deferred = useDeferredValue(content);
  const isSkillMd = path === 'SKILL.md';
  const parsed = isSkillMd ? parseSkillMd(deferred) : null;
  const body = parsed ? parsed.body : deferred;

  if (languageForPath(path) !== 'markdown') {
    return (
      <p className="p-4 text-sm text-muted-foreground">
        Only markdown has a preview; <span className="font-mono">{path}</span> is shown as source.
      </p>
    );
  }

  return (
    <div className="max-h-[560px] space-y-4 overflow-auto p-3">
      {isSkillMd &&
        (parsed ? (
          <FrontmatterCard frontmatter={parsed.frontmatter} />
        ) : (
          <div className="rounded-lg border border-state-failed/30 bg-state-failed/10 p-3 text-xs text-state-failed">
            The frontmatter is missing or not valid YAML. Add a block between{' '}
            <code className="font-mono">---</code> fences, with no anchors or aliases.
          </div>
        ))}
      <SkillMarkdown markdown={body} files={files} onOpenFile={onOpenFile} />
    </div>
  );
}
