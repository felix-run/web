import { useCallback, useEffect, useState } from 'react';
import {
  clearMount,
  getMountLabel,
  hasMount,
  mountTree,
  pickDirectory,
  supportsDirectoryPicker,
  vfs,
} from '@/lib/cowork';
import { Button } from '@felix/ui/button';

/** Compact cowork workspace strip — mount folder or inspect the tab VFS. */
export function WorkspaceStrip() {
  const [mountLabel, setMountLabel] = useState<string | null>(getMountLabel());
  const [files, setFiles] = useState<string[]>([]);
  const [open, setOpen] = useState(false);
  const canMount = supportsDirectoryPicker();

  const refresh = useCallback(async () => {
    if (hasMount()) setFiles(await mountTree());
    else setFiles(vfs.tree());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, mountLabel]);

  return (
    <div className="mx-auto mb-2 w-full max-w-2xl rounded-xl border border-border/50 bg-muted/30 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-foreground">
          {mountLabel ? `Folder · ${mountLabel}` : 'Local VFS'}
        </span>
        <span className="text-muted-foreground">
          Client tools (`local_shell` / `local_open`) run here
        </span>
        <div className="ml-auto flex flex-wrap gap-1">
          {canMount ? (
            mountLabel ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  clearMount();
                  setMountLabel(null);
                  void refresh();
                }}
              >
                Unmount
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs"
                onClick={() => {
                  void (async () => {
                    try {
                      const name = await pickDirectory();
                      setMountLabel(name);
                      await refresh();
                    } catch {
                      // picker cancelled
                    }
                  })();
                }}
              >
                Mount folder
              </Button>
            )
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => {
              setOpen((o) => !o);
              void refresh();
            }}
          >
            {open ? 'Hide files' : 'Files'}
          </Button>
          {!mountLabel ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => {
                vfs.reset();
                void refresh();
              }}
            >
              Clear VFS
            </Button>
          ) : null}
        </div>
      </div>
      {open ? (
        <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-border/40 bg-background p-2 font-mono text-[11px] text-muted-foreground">
          {files.length ? files.slice(0, 80).join('\n') : '(empty)'}
        </pre>
      ) : null}
    </div>
  );
}
