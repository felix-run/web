import { Button } from '@felix/ui/button';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import {
  clearMount,
  getMountLabel,
  hasMount,
  mountTree,
  pickDirectory,
  reconnectMount,
  restoreMount,
  supportsDirectoryPicker,
  vfs,
} from '@/lib/cowork';

/** Compact cowork workspace strip — mount folder or inspect the tab VFS. */
export function WorkspaceStrip() {
  const [mountLabel, setMountLabel] = useState<string | null>(getMountLabel());
  const [reconnectName, setReconnectName] = useState<string | null>(null);
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

  // A folder mounted last session may still be usable. Whether it is depends on
  // a readwrite grant that belongs to the document, not the handle, and that
  // boot is not allowed to ask for — see restoreMount.
  useEffect(() => {
    let cancelled = false;
    void restoreMount().then((result) => {
      if (cancelled) return;
      if (result.status === 'restored') {
        setMountLabel(result.name);
        toast.message(`Reattached ${result.name}`);
      } else if (result.status === 'needs-permission') {
        setReconnectName(result.name);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Must stay inside the click handler: the permission prompt is only allowed to
   * open while the user's gesture is still being processed.
   */
  const onReconnect = useCallback(async () => {
    const name = await reconnectMount();
    if (!name) {
      // Not an error: the operator was asked for a folder and said no, or picked
      // nothing. Reporting a decision back as a failure is how a surface teaches
      // people to stop reading its red.
      toast.message('No folder attached. The chat is using the in-tab workspace.');
      return;
    }
    setReconnectName(null);
    setMountLabel(name);
    await refresh();
    toast.success(`Reattached ${name}`);
  }, [refresh]);

  return (
    <div className="mx-auto mb-2 w-full max-w-3xl px-4 md:px-6">
      <div className="rounded-xl border border-border/50 bg-muted/30 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-foreground">
            {mountLabel ? `Folder · ${mountLabel}` : 'Local VFS'}
          </span>
          {!mountLabel && reconnectName ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2 text-xs"
              onClick={() => void onReconnect()}
            >
              Reconnect {reconnectName}
            </Button>
          ) : null}
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
                    setReconnectName(null);
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
                        setReconnectName(null);
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
          <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-border/40 bg-background p-2 font-mono text-xs text-muted-foreground">
            {files.length ? files.slice(0, 80).join('\n') : '(empty)'}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
