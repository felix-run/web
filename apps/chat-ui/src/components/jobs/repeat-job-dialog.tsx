import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@felix/ui/dialog';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { listJobs } from '@/api';
import { JobCreateForm } from '@/components/jobs/job-create-form';
import { useSharedPoll } from '@/hooks/useSharedPoll';
import { JOBS_POLL_KEY } from '@/lib/harness-glances';

/**
 * "Repeat on a schedule" from a message: the Jobs page's own form in a dialog, with
 * the message as the prompt and the thread's agent selected, so a daily ask becomes a
 * job without a visit to the harness pages. Its failures still reach the operator
 * there: the Needs-you band lists a failing job everyday.
 *
 * What it must not let anyone assume is that the job continues *this* conversation.
 * The scheduler sends the prompt as a turn on the job's own thread (`job:<name>`, or a
 * new one each run), so none of this thread's history comes with it — the dialog says
 * so before the form, where the decision is made.
 *
 * The default export is the lazy chunk the workbench loads on first use.
 */
export default function RepeatJobDialog({
  prompt,
  manifest,
  manifestOptions,
  onClose,
}: {
  /** The message to repeat; `null` is closed. */
  prompt: string | null;
  manifest: string;
  manifestOptions: string[];
  onClose: () => void;
}) {
  const navigate = useNavigate();
  // The Needs-you band's read, on its key: the form needs the list only to say a name
  // would replace a job, and this adds no request while the band is polling.
  const jobs = useSharedPoll(JOBS_POLL_KEY, listJobs, {
    enabled: prompt !== null,
    intervalMs: 30_000,
  }).data;
  return (
    <Dialog open={prompt !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Repeat on a schedule</DialogTitle>
          <DialogDescription>
            Each run sends the prompt as a new turn on the job’s own thread, not this one — none of
            this conversation comes with it, so the prompt has to stand on its own.
          </DialogDescription>
        </DialogHeader>
        {prompt !== null && (
          <JobCreateForm
            manifest={manifest}
            manifestOptions={manifestOptions}
            jobs={jobs ?? []}
            initial={{ prompt, name: jobNameFor(prompt), manifest }}
            agentOnly
            submitLabel="Schedule"
            onCancel={onClose}
            onCreated={(name) => {
              onClose();
              toast.success(`Scheduled ${name}`, {
                action: {
                  label: 'View job',
                  onClick: () =>
                    navigate({
                      pathname: '/harness/jobs',
                      search: `?job=${encodeURIComponent(name)}`,
                    }),
                },
              });
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

/**
 * A name to start from: the message's first few words as a slug. Only a suggestion —
 * the field is editable, and a name that already exists says it would replace that job.
 */
export function jobNameFor(prompt: string): string {
  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .split('-')
    .filter(Boolean)
    .slice(0, 5)
    .join('-')
    .slice(0, 40)
    .replace(/-+$/, '');
}
