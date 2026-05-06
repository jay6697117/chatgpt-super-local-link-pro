import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export interface RequestContext {
  requestId: string;
  startedAt: number;
}

const store = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(fn: () => T, requestId: string = randomUUID()): T {
  return store.run({ requestId, startedAt: Date.now() }, fn);
}

export function getRequestContext(): RequestContext | undefined {
  return store.getStore();
}
