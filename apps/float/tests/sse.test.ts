import { describeSseReader } from '@felix/test-kit/sse';
import { streamChat } from '../src/api';

const args = {
  manifest: 'cowork',
  messages: [{ role: 'user' as const, content: 'hi' }],
  threadId: 'test-thread',
};

// float's reader takes the callback directly rather than a handlers object; the
// framing behavior under test is meant to be identical.
describeSseReader('float', { run: (collect) => streamChat(args, collect) });
