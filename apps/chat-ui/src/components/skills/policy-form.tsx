import type { SkillPolicy, SkillPolicyPatch, SkillPolicyValues } from '@felix/client';
import { Button } from '@felix/ui/button';
import { Input } from '@felix/ui/input';
import { useId, useState } from 'react';
import { toast } from 'sonner';
import { ConfirmButton } from '@/components/confirm-button';
import { usePolicyActions } from './queries';
import { RefusalNotice } from './refusal';

const FIELDS: { key: keyof SkillPolicyValues; label: string }[] = [
  { key: 'min_quality', label: 'Minimum quality' },
  { key: 'block_on_advisory', label: 'Block on an advisory finding' },
  { key: 'require_eval', label: 'Require an evaluation' },
  { key: 'min_eval_uplift', label: 'Minimum evaluation uplift' },
];

function show(value: number | boolean | null): string {
  if (value === null) return 'none';
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  return String(value);
}

/**
 * The tenant's own publish policy, against the one in force.
 *
 * Tighten-only is the rule that makes this form easy to misread, so it is
 * drawn rather than described: each field shows what the tenant set beside
 * what is in force, and where they differ the deployment's setting is the
 * stricter one and won (`source: tenant+settings`). A looser value is stored
 * and does nothing until the setting loosens. "Reset" drops the tenant's
 * policy entirely, which leaves the settings alone deciding.
 */
export function PolicyEditor({ policy }: { policy: SkillPolicy }) {
  const [open, setOpen] = useState(false);
  const { update, reset } = usePolicyActions();
  const tenant = policy.tenant_values;
  const outvoted = tenant
    ? FIELDS.filter(({ key }) => tenant[key] !== policy[key]).map((f) => f.key)
    : [];

  return (
    <div className="mt-3 space-y-2">
      <table className="w-full text-xs">
        <caption className="sr-only">The publish policy, by field</caption>
        <thead>
          <tr className="text-left text-muted-foreground">
            <th scope="col" className="py-1 font-medium">
              Field
            </th>
            <th scope="col" className="py-1 font-medium">
              This tenant set
            </th>
            <th scope="col" className="py-1 font-medium">
              In force
            </th>
          </tr>
        </thead>
        <tbody>
          {FIELDS.map(({ key, label }) => (
            <tr key={key} className="border-t border-border/40">
              <th scope="row" className="py-1 text-left font-normal">
                {label}
              </th>
              <td className="py-1 font-mono">{tenant ? show(tenant[key]) : '—'}</td>
              <td className="py-1 font-mono">
                {show(policy[key])}
                {outvoted.includes(key) && (
                  <span className="ml-1 font-sans text-muted-foreground">(deployment floor)</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="max-w-[48ch] text-xs text-muted-foreground">
        {policy.source === 'settings'
          ? 'No tenant policy: the deployment settings alone decide.'
          : policy.source === 'tenant+settings'
            ? 'A deployment setting is stricter than what this tenant set, and is the one in force where marked.'
            : 'This tenant’s policy is at least as strict as the deployment settings everywhere.'}{' '}
        A tenant can raise the bar and never lower it below the deployment’s settings. A failing
        security scan always blocks.
        {policy.updated_by && (
          <>
            {' '}
            Last changed by <span className="font-mono">{policy.updated_by}</span>.
          </>
        )}
      </p>
      {!open ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setOpen(true)}>
            Edit policy…
          </Button>
          {policy.source !== 'settings' && (
            <ConfirmButton
              size="xs"
              variant="outline"
              destructive
              disabled={reset.isPending}
              question="This tenant's policy is dropped; the deployment settings alone decide."
              confirmLabel="Reset to deployment defaults"
              onConfirm={async () => {
                try {
                  await reset.mutateAsync();
                  toast.success('The publish policy is the deployment’s again.');
                } catch {
                  // Drawn below.
                }
              }}
            >
              Reset to deployment defaults
            </ConfirmButton>
          )}
        </div>
      ) : (
        <PolicyForm
          start={tenant ?? policy}
          busy={update.isPending}
          onCancel={() => {
            update.reset();
            setOpen(false);
          }}
          onSave={async (patch) => {
            try {
              await update.mutateAsync(patch);
              toast.success('Policy saved.');
              setOpen(false);
            } catch {
              // Drawn below.
            }
          }}
        />
      )}
      {update.error ? (
        <RefusalNotice error={update.error} doing="change the publish policy" />
      ) : null}
      {reset.error ? <RefusalNotice error={reset.error} doing="reset the publish policy" /> : null}
    </div>
  );
}

/**
 * The fields the PATCH changes, and only those: a field the operator did not
 * touch is not sent, so a value the deployment already overrides is not
 * re-stored. An empty uplift is `null`, which removes the tenant's floor.
 */
export function policyPatch(start: SkillPolicyValues, next: SkillPolicyValues): SkillPolicyPatch {
  const patch: SkillPolicyPatch = {};
  if (next.min_quality !== start.min_quality) patch.min_quality = next.min_quality;
  if (next.block_on_advisory !== start.block_on_advisory) {
    patch.block_on_advisory = next.block_on_advisory;
  }
  if (next.require_eval !== start.require_eval) patch.require_eval = next.require_eval;
  if (next.min_eval_uplift !== start.min_eval_uplift) patch.min_eval_uplift = next.min_eval_uplift;
  return patch;
}

function PolicyForm({
  start,
  busy,
  onSave,
  onCancel,
}: {
  start: SkillPolicyValues;
  busy: boolean;
  onSave: (patch: SkillPolicyPatch) => void;
  onCancel: () => void;
}) {
  const [quality, setQuality] = useState(String(start.min_quality));
  const [advisory, setAdvisory] = useState(start.block_on_advisory);
  const [requireEval, setRequireEval] = useState(start.require_eval);
  const [uplift, setUplift] = useState(
    start.min_eval_uplift === null ? '' : String(start.min_eval_uplift),
  );
  const ids = { q: useId(), a: useId(), r: useId(), u: useId() };
  // Whole decimal integers only. `Number` reads '' and '   ' as 0 — an emptied
  // field saved a quality floor of zero — and '0x10' and '1e2' as numbers.
  const INTEGER = /^-?\d+$/;
  const qText = quality.trim();
  const uText = uplift.trim();
  const q = Number(qText);
  const u = uText === '' ? null : Number(uText);
  const qBad = !INTEGER.test(qText) || q < 0 || q > 100;
  const uBad = u !== null && (!INTEGER.test(uText) || u < -100 || u > 100);
  const patch = policyPatch(start, {
    min_quality: q,
    block_on_advisory: advisory,
    require_eval: requireEval,
    min_eval_uplift: u,
  });
  const empty = Object.keys(patch).length === 0;

  return (
    <form
      className="space-y-3 rounded-lg bg-muted/40 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!qBad && !uBad && !empty) onSave(patch);
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label htmlFor={ids.q} className="space-y-1 text-xs">
          <span className="block font-medium text-muted-foreground">Minimum quality, 0-100</span>
          <Input
            id={ids.q}
            inputMode="numeric"
            value={quality}
            onChange={(e) => setQuality(e.target.value)}
            aria-invalid={qBad || undefined}
            className="h-8 w-24 font-mono text-sm"
          />
        </label>
        <label htmlFor={ids.u} className="space-y-1 text-xs">
          <span className="block font-medium text-muted-foreground">
            Minimum evaluation uplift, -100 to 100 (empty: none)
          </span>
          <Input
            id={ids.u}
            inputMode="numeric"
            value={uplift}
            onChange={(e) => setUplift(e.target.value)}
            aria-invalid={uBad || undefined}
            className="h-8 w-24 font-mono text-sm"
          />
        </label>
      </div>
      <label htmlFor={ids.a} className="flex items-center gap-2 text-sm">
        <input
          id={ids.a}
          type="checkbox"
          checked={advisory}
          onChange={(e) => setAdvisory(e.target.checked)}
        />
        Block a publish on an advisory security finding
      </label>
      <label htmlFor={ids.r} className="flex items-center gap-2 text-sm">
        <input
          id={ids.r}
          type="checkbox"
          checked={requireEval}
          onChange={(e) => setRequireEval(e.target.checked)}
        />
        Require a succeeded evaluation that counts for the gate
      </label>
      <p className="text-xs text-muted-foreground">
        A value looser than the deployment's setting is saved, and the setting stays in force.
        {u !== null && !requireEval && ' An uplift floor blocks a version with no evaluation too.'}
      </p>
      {(qBad || uBad) && (
        <p role="alert" className="text-xs text-state-failed">
          {qBad
            ? 'Quality is a whole number from 0 to 100.'
            : 'Uplift is a whole number from -100 to 100.'}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy || qBad || uBad || empty}>
          {busy ? 'Saving…' : 'Save policy'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
