import { describeSseReader } from '@felix/test-kit/sse';
import { streamChat } from '../src/api';

const args = { manifest: 'cowork', messages: [{ role: 'user' as const, content: 'hi' }] };

describeSseReader('chat-ui', {
  run: (collect, onCursor) => streamChat(args, { onEvent: collect, onCursor }),
});
