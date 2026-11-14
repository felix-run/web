import { Button } from '@felix/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@felix/ui/dialog';

export type RewindFilesAnswer = 'keep' | 'restore' | 'cancel';

/**
 * What to do with the files a rewind is about to leave behind. Asked here and not after, because
 * every rewind settles the branch it leaves: once it has happened the harness has forgotten what
 * the branch changed. Keep is first because it is what a rewind has always done.
 */
export function RewindFilesDialog({
  files,
  onAnswer,
}: {
  /** How many files the agent changed on the turns being set aside; null when not asking. */
  files: number | null;
  onAnswer: (answer: RewindFilesAnswer) => void;
}) {
  const many = files !== 1;
  return (
    <Dialog open={files !== null} onOpenChange={(open) => !open && onAnswer('cancel')}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {many
              ? `The agent changed ${files} files after this`
              : 'The agent changed a file after this'}
          </DialogTitle>
          <DialogDescription>
            Put {many ? 'them' : 'it'} back as {many ? 'they were' : 'it was'}, or keep{' '}
            {many ? 'them' : 'it'} as {many ? 'they are' : 'it is'}. This can only be chosen now. A
            file edited since is left alone either way.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onAnswer('cancel')}>
            Cancel
          </Button>
          <Button variant="outline" onClick={() => onAnswer('restore')}>
            Put {many ? 'files' : 'it'} back
          </Button>
          <Button onClick={() => onAnswer('keep')}>Keep {many ? 'files' : 'it'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
