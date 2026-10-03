import type { SkillFile } from '@felix/client';
import { isBinaryAssetPath } from '@felix/skill-format';
import { Skeleton } from '@felix/ui/skeleton';
import { useMemo, useState } from 'react';
import { ErrorNotice } from '@/components/error-notice';
import { ViewSwitch } from '@/components/harness/panel';
import { AssetPreview, formatBytes } from './asset-preview';
import { FileTree } from './file-tree';
import { languageForPath } from './highlight';
import { PreviewPane } from './preview-pane';
import { useSkillBundleFiles } from './queries';

/**
 * A stored version's files, read-only: the tree, and the file it opens. Each
 * file carries the digest and size the harness recorded when it was saved —
 * the harness re-checks the bytes against that digest on every read, so what
 * is shown is what was saved.
 *
 * Markdown opens rendered (no raw HTML, no remote images) with the source a
 * switch away; an asset opens as a preview where it is a raster image; any
 * other file is source.
 */
export function SkillBundleBrowser({ name, version }: { name: string; version: string }) {
  const query = useSkillBundleFiles(name, version);
  const [path, setPath] = useState('SKILL.md');
  const [view, setView] = useState<'rendered' | 'source'>('rendered');
  const meta = useMemo(
    () => new Map((query.data?.meta ?? []).map((f) => [f.path, f] as const)),
    [query.data],
  );

  if (query.error) {
    return <ErrorNotice error={query.error} doing={`read ${name} ${version}'s files`} />;
  }
  if (!query.data) return <Skeleton className="h-64 w-full rounded-lg" />;

  const files = query.data.files;
  const file: SkillFile | undefined = meta.get(path);
  const content = files[path];
  const markdown = languageForPath(path) === 'markdown';

  return (
    <div className="@container">
      <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-border/60 @xl:grid-cols-[13rem_minmax(0,1fr)]">
        <div className="border-b border-border/60 @xl:border-r @xl:border-b-0">
          <FileTree files={files} activePath={path} readOnly onSelect={setPath} />
        </div>
        <div className="min-w-0">
          <div className="flex min-h-10 flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/60 px-3 py-1.5 text-xs">
            <span className="font-mono">{path}</span>
            {file && (
              <span className="font-mono text-muted-foreground" title={`sha256 ${file.sha256}`}>
                {formatBytes(file.size)} · sha256 {file.sha256.slice(0, 12)}
              </span>
            )}
            {markdown && (
              <span className="ml-auto">
                <ViewSwitch
                  label="Show as"
                  value={view}
                  options={[
                    ['rendered', 'Rendered'],
                    ['source', 'Source'],
                  ]}
                  onChange={setView}
                />
              </span>
            )}
          </div>
          {content === undefined ? (
            <p className="p-4 text-sm text-muted-foreground">Choose a file.</p>
          ) : isBinaryAssetPath(path) ? (
            <AssetPreview path={path} base64Content={content} contentType={file?.content_type} />
          ) : markdown && view === 'rendered' ? (
            <PreviewPane path={path} content={content} files={files} onOpenFile={setPath} />
          ) : (
            <pre className="max-h-[560px] overflow-auto bg-code-surface p-3 font-mono text-xs leading-5 whitespace-pre-wrap break-words">
              {content}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
