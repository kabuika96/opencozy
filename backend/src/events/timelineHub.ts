import type { TimelineEventRecord } from "../types.js";

type Listener = (event: TimelineEventRecord) => void;

export type TimelineHub = {
  publish(event: TimelineEventRecord): void;
  subscribe(threadId: string, listener: Listener): () => void;
};

export function createTimelineHub(): TimelineHub {
  const listeners = new Map<string, Set<Listener>>();

  return {
    publish(event) {
      listeners.get(event.threadId)?.forEach((listener) => listener(event));
    },
    subscribe(threadId, listener) {
      const threadListeners = listeners.get(threadId) ?? new Set<Listener>();
      threadListeners.add(listener);
      listeners.set(threadId, threadListeners);

      return () => {
        threadListeners.delete(listener);
        if (threadListeners.size === 0) {
          listeners.delete(threadId);
        }
      };
    },
  };
}
