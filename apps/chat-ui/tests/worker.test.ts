import { describeProxyWorker, type ProxyWorker } from '@felix/test-kit/proxy-worker';
import worker from '../worker/index';

// The two apps' Workers are byte-identical outside their comments. Running one
// suite against both is what keeps that true.
describeProxyWorker('chat-ui', worker as unknown as ProxyWorker);
