import {
  BINARY_ASSET_EXTENSIONS,
  base64DecodedSize,
  encodeBase64,
  isBinaryAssetPath,
  MAX_BINARY_ASSET_BYTES,
  type ValidationIssue,
} from '@felix/skill-format';
import { Button } from '@felix/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@felix/ui/tabs';
import { Columns2Icon } from 'lucide-react';
import { type Ref, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { AssetPreview, formatBytes } from './asset-preview';
import { isTextPath, sanitizeAssetFileName } from './bundle-paths';
import { CodeEditor, type CodeEditorHandle } from './code-editor';
import { FileTree } from './file-tree';
import { FrontmatterForm } from './frontmatter-form';
import { languageForPath } from './highlight';
import { PreviewPane } from './preview-pane';
import type { SkillBundleState } from './use-skill-bundle';

/**
 * The bundle editor: the file tree, the open file, and — for markdown — a
 * preview beside it on a wide pane or folded under it on a narrow one.
 *
 * SKILL.md opens on two tabs over one text: the source, and the frontmatter as
 * fields. Both edit the same string, so neither can fall out of step with the
 * other. Binary assets are previewed (raster images only) and replaced through
 * the picker; they are never opened as text.
 */
export function SkillBundleEditor({
  bundle,
  slug,
  validationErrors = [],
  errorLines,
  editorRef,
  issuesId,
}: {
  bundle: SkillBundleState;
  slug: string;
  validationErrors?: ValidationIssue[];
  errorLines?: Set<number>;
  editorRef?: Ref<CodeEditorHandle>;
  /** The id of the validation issue list, which the source editor is described by. */
  issuesId?: string;
}) {
  const fallbackEditorRef = useRef<CodeEditorHandle>(null);
  const assetInputRef = useRef<HTMLInputElement>(null);
  const [showPreview, setShowPreview] = useState(true);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const activeContent = bundle.files[bundle.activePath];
  const isSkillMd = bundle.activePath === 'SKILL.md';
  const activeIsText = isTextPath(bundle.activePath) || isSkillMd;
  const activeIsBinary = isBinaryAssetPath(bundle.activePath);
  const previewable = languageForPath(bundle.activePath) === 'markdown';

  const uploadAsset = async (file: File): Promise<string | null> => {
    if (!isBinaryAssetPath(file.name)) {
      return 'Not a type the harness stores: use png, jpg, gif, webp, ico, pdf or zip.';
    }
    if (file.size > MAX_BINARY_ASSET_BYTES) {
      return `${formatBytes(file.size)} is over the harness's ${MAX_BINARY_ASSET_BYTES / (1024 * 1024)} MB asset limit.`;
    }
    const path = `assets/${sanitizeAssetFileName(file.name)}`;
    const base64 = encodeBase64(new Uint8Array(await file.arrayBuffer()));
    if (bundle.files[path] === undefined && !bundle.createFile(path)) {
      return 'That name is not one the harness accepts.';
    }
    bundle.setFileContent(path, base64);
    bundle.setActivePath(path);
    return null;
  };

  const editor =
    activeContent === undefined ? (
      <p className="p-4 text-sm text-muted-foreground">Choose a file to edit.</p>
    ) : activeIsBinary ? (
      <AssetPreview
        path={bundle.activePath}
        base64Content={activeContent}
        onReplace={() => assetInputRef.current?.click()}
      />
    ) : activeIsText ? (
      <CodeEditor
        ref={editorRef ?? fallbackEditorRef}
        path={bundle.activePath}
        value={activeContent}
        issuesId={isSkillMd ? issuesId : undefined}
        onChange={(next) => bundle.setFileContent(bundle.activePath, next)}
        errorLines={isSkillMd ? errorLines : undefined}
      />
    ) : (
      <p className="p-4 text-sm text-muted-foreground">
        <span className="font-mono">{bundle.activePath}</span> is not a text type this editor opens.
      </p>
    );

  const statusLine = (
    <div className="flex items-center justify-between gap-2 border-t border-border/60 px-3 py-1.5 font-mono text-xs text-muted-foreground">
      <span className="flex min-w-0 items-center gap-1.5">
        {bundle.dirty && (
          <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-state-blocked" />
        )}
        <span className="truncate">{bundle.activePath}</span>
        {bundle.dirty && <span className="shrink-0 font-sans">· unsaved</span>}
      </span>
      <span className="shrink-0 tabular-nums">
        {activeIsBinary
          ? formatBytes(base64DecodedSize(activeContent ?? ''))
          : `${(activeContent ?? '').split('\n').length} lines · ${(activeContent ?? '').length} chars`}
      </span>
    </div>
  );

  return (
    // Container queries, not breakpoints: the editor sits in a page held to the
    // reading measure, so the *viewport* being wide says nothing about whether
    // a preview beside the source would leave the source room to be read.
    <div className="@container">
      <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-border/60 @xl:grid-cols-[13rem_minmax(0,1fr)]">
        <div className="border-b border-border/60 @xl:border-r @xl:border-b-0">
          <FileTree
            files={bundle.files}
            pendingDirs={bundle.pendingDirs}
            activePath={bundle.activePath}
            onSelect={bundle.setActivePath}
            onCreateFile={bundle.createFile}
            onCreateDir={bundle.createDir}
            onRename={bundle.renamePath}
            onDelete={bundle.deletePath}
            onRequestUpload={() => assetInputRef.current?.click()}
          />
          <input
            ref={assetInputRef}
            type="file"
            accept={BINARY_ASSET_EXTENSIONS.join(',')}
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              setUploadError(await uploadAsset(file));
            }}
          />
          {uploadError && (
            <p
              role="alert"
              className="border-t border-border/60 px-2 py-1.5 text-xs text-state-failed"
            >
              {uploadError}
            </p>
          )}
        </div>
        <div className="min-w-0">
          <div
            className={cn(
              'grid grid-cols-1',
              showPreview && previewable && '@5xl:grid-cols-2 @5xl:divide-x @5xl:divide-border/60',
            )}
          >
            <div className="min-w-0">
              {isSkillMd ? (
                <Tabs defaultValue="source" className="gap-0">
                  <div className="flex items-center justify-between border-b border-border/60 px-2 py-1">
                    <TabsList aria-label="SKILL.md view" className="h-8">
                      <TabsTrigger value="source" className="px-2.5 text-xs">
                        Source
                      </TabsTrigger>
                      <TabsTrigger value="frontmatter" className="px-2.5 text-xs">
                        Frontmatter
                      </TabsTrigger>
                    </TabsList>
                    {previewable && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="hidden h-7 gap-1 px-2 text-xs @5xl:flex"
                        onClick={() => setShowPreview((prev) => !prev)}
                        aria-pressed={showPreview}
                      >
                        <Columns2Icon className="size-3.5" aria-hidden />
                        Preview
                      </Button>
                    )}
                  </div>
                  <TabsContent value="source" className="p-2">
                    {editor}
                  </TabsContent>
                  <TabsContent value="frontmatter" className="max-h-[560px] overflow-auto p-3">
                    <FrontmatterForm
                      content={activeContent ?? ''}
                      slug={slug}
                      errors={validationErrors}
                      onChange={(next) => bundle.setFileContent('SKILL.md', next)}
                    />
                  </TabsContent>
                </Tabs>
              ) : (
                <div className="p-2">{editor}</div>
              )}
              {statusLine}
            </div>
            {showPreview && previewable && (
              <div className="hidden min-w-0 @5xl:block">
                <div className="flex min-h-10 items-center border-b border-border/60 px-3 text-xs font-medium text-muted-foreground">
                  Preview
                </div>
                <PreviewPane
                  path={bundle.activePath}
                  content={activeContent ?? ''}
                  files={bundle.files}
                  onOpenFile={bundle.setActivePath}
                />
              </div>
            )}
          </div>
          {previewable && (
            <details className="border-t border-border/60 @5xl:hidden">
              <summary className="cursor-pointer px-3 py-1.5 text-xs font-medium text-muted-foreground">
                Preview
              </summary>
              <PreviewPane
                path={bundle.activePath}
                content={activeContent ?? ''}
                files={bundle.files}
                onOpenFile={bundle.setActivePath}
              />
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
