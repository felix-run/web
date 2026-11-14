import { describeError, SideQuestionError } from '@felix/client';
import type { RefObject } from 'react';
import { useCallback, useState } from 'react';
import { askAboutThread as askThread } from '@/api/client';
import type { SideQuestion } from '@/app/shell-context';

export function useSideQuestion(threadIdRef: RefObject<string>, unsentRef: RefObject<Set<string>>) {
  // The last side question, keyed by thread like the style: another thread's answer never shows.
  const [side, setSide] = useState<({ thread: string } & SideQuestion) | null>(null);

  /**
   * `/ask`: a side question about the thread on screen, answered beside the transcript. No
   * lease and no write, so it runs mid-run and from a watching tab. A thread the harness has
   * never seen has nothing to answer from, which is said rather than sent.
   */
  const askAboutThread = useCallback(async (question: string) => {
    const id = threadIdRef.current;
    const settle = (patch: Partial<SideQuestion>) =>
      setSide((was) =>
        was?.thread === id && was.question === question
          ? { ...was, ...patch, pending: false }
          : was,
      );
    setSide({ thread: id, question, pending: true });
    if (unsentRef.current.has(id)) {
      settle({ error: 'This conversation has nothing to ask about yet: send a message first.' });
      return;
    }
    void askThread({ threadId: id, question })
      .then((answer) => settle({ answer }))
      .catch((err) =>
        settle({
          error:
            err instanceof SideQuestionError && err.code === 'unknown_thread'
              ? 'The harness has no record of this conversation yet, so there is nothing to ask about.'
              : describeError(err, 'answer that question').message,
        }),
      );
  }, []);
  const dismissSideQuestion = useCallback(() => setSide(null), []);

  return { side, askAboutThread, dismissSideQuestion };
}
