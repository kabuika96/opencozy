import { useEffect, useRef, useState, type RefObject } from "react";

type Position = { top: number; following: boolean };

/** Owns only the Timeline scroller. Never moves the page or a preview. */
export function useTimelineScroll(
  contentRef: RefObject<HTMLElement | null>,
  viewKey: string,
  revision: unknown,
  enabled: boolean,
) {
  const positions = useRef(new Map<string, Position>());
  const active = useRef<{ element: HTMLElement; key: string; following: boolean } | null>(null);
  const [showJump, setShowJump] = useState(false);
  const updateRef = useRef<() => void>(() => {});
  const prependAnchor = useRef<{ height: number; top: number } | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let disposed = false;
    let cleanup = () => {};
    let frame = 0;
    const element = contentRef.current;
    if (!element) return;
    const saved = positions.current.get(viewKey);
    const state = { element, key: viewKey, following: saved?.following ?? true };
    active.current = state;
    element.scrollTop = saved && !saved.following ? saved.top : element.scrollHeight;
    setShowJump(!state.following);
    const onScroll = () => {
      state.following = element.scrollHeight - element.clientHeight - element.scrollTop < 64;
      positions.current.set(viewKey, { top: element.scrollTop, following: state.following });
      setShowJump(!state.following);
    };
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (disposed) return;
        if (prependAnchor.current) {
          const anchor = prependAnchor.current;
          element.scrollTop = anchor.top + element.scrollHeight - anchor.height;
          prependAnchor.current = null;
        } else if (state.following) {
          element.scrollTop = element.scrollHeight;
        }
      });
    };
    updateRef.current = update;
    element.addEventListener("scroll", onScroll, { passive: true });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    observer?.observe(element);
    const log = element.querySelector(".lh-mobile-chat-log");
    if (log) observer?.observe(log);
    update();
    cleanup = () => {
      // React may already have replaced the old transcript and clamped scrollTop.
      // Keep the last observed reading position instead of sampling the new DOM.
      element.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      cancelAnimationFrame(frame);
      active.current = null;
      updateRef.current = () => {};
    };
    return () => { disposed = true; prependAnchor.current = null; cleanup(); };
  }, [contentRef, viewKey, enabled]);

  useEffect(() => { updateRef.current(); }, [revision]);

  return {
    showJump,
    jumpToBottom() {
      const state = active.current;
      if (!state) return;
      state.following = true;
      setShowJump(false);
      state.element.scrollTop = state.element.scrollHeight;
    },
    preservePrepend() {
      const state = active.current;
      if (state) prependAnchor.current = { height: state.element.scrollHeight, top: state.element.scrollTop };
    },
    forgetThread(threadId: string) {
      for (const key of positions.current.keys()) if (key.startsWith(`${threadId}:`)) positions.current.delete(key);
    },
  };
}
