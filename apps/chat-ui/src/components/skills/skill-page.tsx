import { isSkillLibraryError } from '@felix/client';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@felix/ui/tabs';
import { ArrowLeftIcon, PuzzleIcon } from 'lucide-react';
import { useContext, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { PageBack, PageHeader, Panel, PanelBody } from '@/components/harness/panel';
import { ReadFailure } from '@/components/inspector/primitives';
import { EditPanel } from './edit-panel';
import { EvalsPanel } from './evals-panel';
import { FeedbackPanel } from './feedback-panel';
import { useLibrarySkill } from './queries';
import { ReviewPanel } from './review-panel';
import { ShadowsUploadNotice } from './skill-status';
import { EDITOR, leavesSkill, SKILL_TABS, type SkillAddress, type SkillTab } from './skill-tabs';
import { UnsavedChangesGuard } from './unsaved-guard';
import { useSkillEditor } from './use-skill-editor';
import { VersionPicker } from './version-picker';
import { VersionsPanel } from './versions-panel';

/**
 * One skill: its editor, its versions and their files, the gate's verdict,
 * its evaluations and its feedback, each a tab, all in the address (`?skill=&tab=&v=&against=`) so any view of it is
 * a link someone else can open.
 *
 * The editor's working copy lives here, above the tabs, so a trip to Versions
 * to diff it — and back — keeps the edits. Leaving the page with edits unsaved
 * asks first.
 */
export function SkillPage({
  name,
  address,
  onAddress,
  backTo,
}: {
  name: string;
  address: SkillAddress;
  onAddress: (next: Partial<SkillAddress>) => void;
  backTo: string;
}) {
  const skill = useLibrarySkill(name);
  const layoutBack = useContext(PageBack);
  const detail = skill.data;
  const missing = isMissing(skill.error);
  // Sticky: once the Edit tab has been opened, the working copy stays loaded.
  const [editing, setEditing] = useState(address.tab === 'edit');
  useEffect(() => {
    if (address.tab === 'edit') setEditing(true);
  }, [address.tab]);
  const editor = useSkillEditor(name, detail, editing);

  const newest = detail?.versions[0]?.version ?? null;
  const version =
    address.version && detail?.versions.some((v) => v.version === address.version)
      ? address.version
      : newest;
  // An `against` the skill does not hold is a stale or hand-edited link: it
  // falls back to the default comparison rather than asking for a version
  // that does not exist.
  const knownAgainst =
    address.against === EDITOR || detail?.versions.some((v) => v.version === address.against)
      ? address.against
      : null;
  const against =
    knownAgainst ??
    (detail?.live_version && detail.live_version !== version
      ? detail.live_version
      : (detail?.versions.find((v) => v.version === version)?.parent_version ?? version));

  return (
    <Panel>
      <Tabs
        value={address.tab}
        onValueChange={(tab) => onAddress({ tab: tab as SkillTab })}
        className="min-h-0 flex-1 gap-0"
      >
        {/* Narrow, the layout puts a way back in the icon's place — to the
            Harness list. From a skill the step back is the library, so the
            chevron goes there and the Library link stands down: two back
            controls a row apart, to two places, read as one doubled. */}
        <PageBack.Provider value={layoutBack ? { to: backTo, label: 'Back to the library' } : null}>
          <PageHeader
            icon={<PuzzleIcon />}
            title={name}
            value={
              detail
                ? detail.live_version
                  ? `live ${detail.live_version}`
                  : 'nothing live'
                : undefined
            }
            valueMono
            controls={
              <>
                {!layoutBack && (
                  <Link
                    to={backTo}
                    className="inline-flex items-center gap-1 rounded-sm text-xs text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
                  >
                    <ArrowLeftIcon aria-hidden className="size-3" />
                    Library
                  </Link>
                )}
                {/* No strip over a link to nothing: six tab stops that each led to
                    the same "no skill called" line. */}
                {!missing && (
                  <TabsList
                    aria-label={`${name} view`}
                    className="w-auto group-data-[orientation=horizontal]/tabs:h-8"
                  >
                    {SKILL_TABS.filter((t) => t.ready).map((t) => (
                      <TabsTrigger key={t.id} value={t.id} className="px-2.5 text-xs">
                        {t.label}
                        {t.id === 'edit' && editor.bundle.dirty && (
                          <>
                            <span aria-hidden className="size-1.5 rounded-full bg-state-blocked" />
                            <span className="sr-only"> (unsaved)</span>
                          </>
                        )}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                )}
              </>
            }
          />
        </PageBack.Provider>
        <UnsavedChangesGuard
          when={editor.bundle.dirty}
          leaves={leavesSkill}
          onKeep={() =>
            document.querySelector<HTMLTextAreaElement>('textarea[data-skill-source]')?.focus()
          }
        />
        <PanelBody className="space-y-4">
          {missing ? (
            <SkillNotFound name={name} backTo={backTo} />
          ) : skill.error ? (
            <ReadFailure
              error={skill.error}
              doing={`read ${name} from the skill library`}
              lastOkAt={detail ? skill.dataUpdatedAt : null}
              onRetry={() => void skill.refetch()}
            />
          ) : null}
          {detail?.shadows_operator_upload && <ShadowsUploadNotice name={name} />}
          {!detail ? (
            skill.isPending ? (
              <p role="status" className="text-sm text-muted-foreground">
                Reading {name}…
              </p>
            ) : null
          ) : (
            <>
              <TabsContent value="edit">
                <EditPanel name={name} editor={editor} />
              </TabsContent>
              <TabsContent value="versions">
                {version && (
                  <VersionsPanel
                    detail={detail}
                    selected={version}
                    against={against ?? version}
                    editorSkillMd={editing ? (editor.bundle.files['SKILL.md'] ?? null) : null}
                    onCompare={(v, a) => onAddress({ version: v, against: a })}
                  />
                )}
              </TabsContent>
              <TabsContent value="review" className="space-y-3">
                {version && (
                  <>
                    <VersionPicker
                      versions={detail.versions}
                      liveVersion={detail.live_version}
                      value={version}
                      onChange={(v) => onAddress({ version: v })}
                    />
                    <ReviewPanel
                      name={name}
                      version={version}
                      liveVersion={detail.live_version}
                      policyTo={backTo}
                    />
                  </>
                )}
              </TabsContent>
              <TabsContent value="evals">
                {version && (
                  <EvalsPanel
                    detail={detail}
                    version={version}
                    onVersion={(v) => onAddress({ version: v })}
                  />
                )}
              </TabsContent>
              <TabsContent value="feedback">
                {version && (
                  <FeedbackPanel
                    detail={detail}
                    version={detail.live_version ?? version}
                    onApplyToEditor={(v) => {
                      // A new edit based on the AI draft: the working copy is
                      // replaced, and the next save names that draft as its parent.
                      setEditing(true);
                      editor.reloadFrom(v);
                      onAddress({ tab: 'edit' });
                    }}
                  />
                )}
              </TabsContent>
            </>
          )}
        </PanelBody>
      </Tabs>
    </Panel>
  );
}

/** A 404, or a name no library could hold: the link points at nothing. */
function isMissing(err: unknown): boolean {
  return isSkillLibraryError(err) && (err.status === 404 || err.code === 'invalid_address');
}

export function SkillNotFound({ name, backTo }: { name: string; backTo: string }) {
  return (
    <p role="status" className="text-sm">
      The skill library has no skill called <span className="font-mono">{name.slice(0, 80)}</span>.{' '}
      <Link
        to={backTo}
        className="text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
      >
        Back to the library
      </Link>
    </p>
  );
}
