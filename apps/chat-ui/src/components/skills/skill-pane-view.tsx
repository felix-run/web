import { isSkillLibraryError } from '@felix/client';
import { Link } from 'react-router';
import { ReadFailure } from '@/components/inspector/primitives';
import { ItemHeader } from '@/components/pane/pane-parts';
import { type PaneItem, updatePaneSkill } from '@/lib/side-pane';
import { EditPanel } from './edit-panel';
import { SkillLibraryContext, useLibrarySkill } from './queries';
import { QueryRoot } from './query-root';
import { useSkillEditor } from './use-skill-editor';

type SkillItem = Extract<PaneItem, { kind: 'skill' }>;

/**
 * A skill's editor in the side pane: the bundle, what the harness will say about it, and the
 * save, beside the conversation it is being written for. The lazy entry point the pane loads.
 *
 * The pane renders only the tab in front, so the working copy and any merge in progress are
 * handed to the pane's store as they change and handed back on the next mount
 * (`SkillEditSnapshot`); a tab switch, a visit to `/harness` and a reload all keep the edit.
 */
export default function SkillPaneView({ threadId, item }: { threadId: string; item: SkillItem }) {
  return (
    <QueryRoot>
      <SkillLibraryContext.Provider value={item.library}>
        <SkillPaneEditor threadId={threadId} item={item} />
      </SkillLibraryContext.Provider>
    </QueryRoot>
  );
}

function SkillPaneEditor({ threadId, item }: { threadId: string; item: SkillItem }) {
  const skill = useLibrarySkill(item.name);
  const detail = skill.data;
  const editor = useSkillEditor(item.name, detail, {
    kept: item.edit,
    onKeep: (edit) => updatePaneSkill(threadId, item.key, edit),
  });
  const q = new URLSearchParams({ skill: item.name });
  if (item.library) q.set('lib', item.library);
  const missing = isSkillLibraryError(skill.error) && skill.error.status === 404;

  return (
    <>
      <ItemHeader
        name={item.name}
        mono
        meta={[
          item.library === 'me' ? 'My skills' : 'Team library',
          detail ? (detail.live_version ? `live ${detail.live_version}` : 'nothing live') : null,
        ]}
        actions={
          <Link
            to={`/harness/skills?${q}`}
            className="inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring focus-visible:outline-none"
          >
            Versions
          </Link>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {missing ? (
          <p className="text-sm text-muted-foreground">
            There is no skill called <span className="font-mono">{item.name}</span> in this library
            any more.
          </p>
        ) : (
          <>
            {/* A failed re-read never takes the editor away: the edit is still here, and a
                refused save re-reads the skill to name the version that won. */}
            {skill.error ? (
              <ReadFailure
                error={skill.error}
                doing={`read ${item.name} from the skill library`}
                lastOkAt={detail ? skill.dataUpdatedAt : null}
                onRetry={() => void skill.refetch()}
              />
            ) : null}
            {(detail || !skill.error) && <EditPanel name={item.name} editor={editor} />}
          </>
        )}
      </div>
    </>
  );
}
