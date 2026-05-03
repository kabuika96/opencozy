type TouchScrollHost = Pick<HTMLElement, "addEventListener" | "removeEventListener" | "querySelector">;
type TouchScrollTarget = Pick<HTMLElement, "addEventListener" | "removeEventListener">;
type TouchScrollOptions = {
  onUserScroll?: () => void;
};

const MOMENTUM_MIN_VELOCITY = 0.18;
const MOMENTUM_STOP_VELOCITY = 0.015;
const MOMENTUM_FRICTION_PER_FRAME = 0.92;
const MAX_FRAME_MS = 32;
const TAP_MOVE_TOLERANCE = 7;

function now(): number {
  return globalThis.performance?.now() ?? Date.now();
}

function requestFrame(callback: FrameRequestCallback): number {
  if (typeof globalThis.requestAnimationFrame === "function") {
    return globalThis.requestAnimationFrame(callback);
  }

  return globalThis.setTimeout(() => callback(now()), 16);
}

function cancelFrame(handle: number): void {
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(handle);
    return;
  }

  globalThis.clearTimeout(handle);
}

function touchY(event: TouchEvent): number | null {
  if (event.touches.length !== 1) {
    return null;
  }

  return event.touches[0]?.pageY ?? null;
}

function containTouchMove(event: TouchEvent): void {
  if (event.cancelable) {
    event.preventDefault();
  }

  event.stopImmediatePropagation();
}

export function bindTerminalTouchScroll(
  target: TouchScrollTarget,
  hostOrFocus?: TouchScrollHost | (() => void),
  focusTerminal?: () => void,
  options: TouchScrollOptions = {}
): () => void {
  const host = typeof hostOrFocus === "function" || hostOrFocus === undefined ? (target as TouchScrollHost) : hostOrFocus;
  const focus = typeof hostOrFocus === "function" ? hostOrFocus : focusTerminal;
  const viewport = host.querySelector<HTMLElement>(".xterm-viewport");
  if (!viewport) {
    return () => undefined;
  }

  let lastTouchY: number | null = null;
  let startTouchY: number | null = null;
  let didDrag = false;
  let lastTouchAt = 0;
  let velocity = 0;
  let momentumFrame: number | null = null;
  let lastMomentumAt = 0;

  const stopMomentum = () => {
    if (momentumFrame !== null) {
      cancelFrame(momentumFrame);
      momentumFrame = null;
    }
  };

  const runMomentum = (timestamp: number) => {
    if (momentumFrame === null) {
      return;
    }

    const elapsed = Math.min(timestamp - lastMomentumAt, MAX_FRAME_MS);
    lastMomentumAt = timestamp;

    const previousScrollTop = viewport.scrollTop;
    viewport.scrollTop += velocity * elapsed;

    if (viewport.scrollTop === previousScrollTop || Math.abs(velocity) < MOMENTUM_STOP_VELOCITY) {
      momentumFrame = null;
      return;
    }

    velocity *= Math.pow(MOMENTUM_FRICTION_PER_FRAME, elapsed / 16);
    momentumFrame = requestFrame(runMomentum);
  };

  const startMomentum = () => {
    if (Math.abs(velocity) < MOMENTUM_MIN_VELOCITY) {
      return;
    }

    lastMomentumAt = now();
    momentumFrame = requestFrame(runMomentum);
  };

  const handleTouchStart = (event: TouchEvent) => {
    const y = touchY(event);
    if (y === null) {
      lastTouchY = null;
      velocity = 0;
      return;
    }

    stopMomentum();
    lastTouchY = y;
    startTouchY = y;
    didDrag = false;
    lastTouchAt = now();
    velocity = 0;
    event.stopImmediatePropagation();
  };

  const handleTouchMove = (event: TouchEvent) => {
    const y = touchY(event);
    if (y === null || lastTouchY === null) {
      lastTouchY = y;
      velocity = 0;
      return;
    }

    const timestamp = now();
    const elapsed = Math.max(timestamp - lastTouchAt, 1);
    const delta = lastTouchY - y;
    const totalDelta = startTouchY === null ? 0 : Math.abs(startTouchY - y);
    lastTouchY = y;
    lastTouchAt = timestamp;

    if (!didDrag && totalDelta <= TAP_MOVE_TOLERANCE) {
      return;
    }

    didDrag = true;

    if (delta === 0) {
      return;
    }

    const previousScrollTop = viewport.scrollTop;
    viewport.scrollTop += delta;
    const didScroll = viewport.scrollTop !== previousScrollTop;
    velocity = didScroll ? delta / elapsed : 0;
    if (didScroll) {
      options.onUserScroll?.();
    }
    containTouchMove(event);
  };

  const handleTouchEnd = () => {
    if (lastTouchY !== null && !didDrag) {
      focus?.();
    }

    lastTouchY = null;
    startTouchY = null;
    didDrag = false;
    startMomentum();
  };

  const handleTouchCancel = () => {
    lastTouchY = null;
    startTouchY = null;
    didDrag = false;
    velocity = 0;
    stopMomentum();
  };

  const handleClick = (event: MouseEvent) => {
    focus?.();
    event.stopImmediatePropagation();
  };

  target.addEventListener("touchstart", handleTouchStart, { capture: true, passive: true });
  target.addEventListener("touchmove", handleTouchMove, { capture: true, passive: false });
  target.addEventListener("touchend", handleTouchEnd, { capture: true, passive: true });
  target.addEventListener("touchcancel", handleTouchCancel, { capture: true, passive: true });
  target.addEventListener("click", handleClick, { capture: true });

  return () => {
    stopMomentum();
    target.removeEventListener("touchstart", handleTouchStart, { capture: true });
    target.removeEventListener("touchmove", handleTouchMove, { capture: true });
    target.removeEventListener("touchend", handleTouchEnd, { capture: true });
    target.removeEventListener("touchcancel", handleTouchCancel, { capture: true });
    target.removeEventListener("click", handleClick, { capture: true });
  };
}
