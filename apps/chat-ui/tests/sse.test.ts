import { describeSseReader } from '@felix/test-kit/sse';
import { streamChat } from '../src/api';

const args = { manifest: 'cowork', messages: [{ role: 'user' as const, content: 'hi' }] };

describeSseReader('chat-ui', {
  run: (collect) => streamChat(args, { onEvent: collect }),
  runWithVariant: (collect) =>
    streamChat(args, { onEvent: () => {}, onVariant: (v) => collect(v) }),
});
