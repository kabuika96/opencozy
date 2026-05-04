type TouchScrollHost = Pick<HTMLElement, "addEventListener" | "removeEventListener" | "querySelector">;
type TouchScrollTarget = Pick<HTMLElement, "addEventListener" | "removeEventListener">;
export type TerminalTouchTapPoint = {
  clientX: number;
  clientY: number;
};
type TouchScrollOptions = {
  onSelectionEnd?: (point: TerminalTouchTapPoint) => void;
  onSelectionMove?: (point: TerminalTouchTapPoint) => void;
  onSelectionStart?: (point: TerminalTouchTapPoint) => void;
  onTap?: (point: TerminalTouchTapPoint) => void;
  onUserScroll?: () => void;
};

const MOMENTUM_MIN_VELOCITY = 0.18;
const MOMENTUM_STOP_VELOCITY = 0.015;
const MOMENTUM_FRICTION_PER_FRAME = 0.92;
const MAX_FRAME_MS = 32;
const TAP_MOVE_TOLERANCE = 7;
const LONG_PRESS_SELECTION_MS = 420;

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

function touchPoint(event: TouchEvent): TerminalTouchTapPoint | null {
  const touch = event.touches[0] ?? event.changedTouches[0];
  if (!touch) {
    return null;
  }

  return {
    clientX: touch.clientX ?? touch.pageX,
    clientY: touch.clientY ?? touch.pageY
  };
}

function containTouchMove(event: TouchEvent): void {
  if (event.cancelable) {
    event.preventDefault();
  }

  event.stopImmediatePropagation();
}

function suppressBrowserTap(event: TouchEvent): void {
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
  let lastTouchPoint: TerminalTouchTapPoint | null = null;
  let startTouchY: number | null = null;
  let didDrag = false;
  let lastTouchAt = 0;
  let velocity = 0;
  let momentumFrame: number | null = null;
  let longPressTimer: number | null = null;
  let selecting = false;
  let lastMomentumAt = 0;
  let suppressClickUntil = 0;

  const stopMomentum = () => {
    if (momentumFrame !== null) {
      cancelFrame(momentumFrame);
      momentumFrame = null;
    }
  };

  const clearLongPressTimer = () => {
    if (longPressTimer !== null) {
      globalThis.clearTimeout(longPressTimer);
      longPressTimer = null;
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
      lastTouchPoint = null;
      velocity = 0;
      return;
    }

    stopMomentum();
    clearLongPressTimer();
    lastTouchY = y;
    lastTouchPoint = touchPoint(event);
    startTouchY = y;
    didDrag = false;
    lastTouchAt = now();
    velocity = 0;
    selecting = false;
    longPressTimer = globalThis.setTimeout(() => {
      if (!lastTouchPoint || didDrag) {
        return;
      }

      selecting = true;
      options.onSelectionStart?.(lastTouchPoint);
    }, LONG_PRESS_SELECTION_MS);
    event.stopImmediatePropagation();
  };

  const handleTouchMove = (event: TouchEvent) => {
    const y = touchY(event);
    if (y === null || lastTouchY === null) {
      lastTouchY = y;
      lastTouchPoint = touchPoint(event);
      velocity = 0;
      return;
    }

    const timestamp = now();
    const elapsed = Math.max(timestamp - lastTouchAt, 1);
    const delta = lastTouchY - y;
    const totalDelta = startTouchY === null ? 0 : Math.abs(startTouchY - y);
    lastTouchY = y;
    lastTouchPoint = touchPoint(event);
    lastTouchAt = timestamp;

    if (selecting) {
      if (lastTouchPoint) {
        options.onSelectionMove?.(lastTouchPoint);
      }
      containTouchMove(event);
      return;
    }

    if (!didDrag && totalDelta <= TAP_MOVE_TOLERANCE) {
      return;
    }

    clearLongPressTimer();
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

  const handleTouchEnd = (event: TouchEvent) => {
    const point = touchPoint(event) ?? lastTouchPoint;
    clearLongPressTimer();

    if (selecting) {
      if (point) {
        options.onSelectionEnd?.(point);
      }
      lastTouchY = null;
      lastTouchPoint = null;
      startTouchY = null;
      didDrag = false;
      selecting = false;
      velocity = 0;
      return;
    }

    if (lastTouchY !== null && !didDrag) {
      if (point && options.onTap) {
        options.onTap(point);
      } else {
        focus?.();
      }
      suppressBrowserTap(event);
      suppressClickUntil = now() + 700;
    }

    lastTouchY = null;
    lastTouchPoint = null;
    startTouchY = null;
    didDrag = false;
    selecting = false;
    startMomentum();
  };

  const handleTouchCancel = () => {
    clearLongPressTimer();
    lastTouchY = null;
    lastTouchPoint = null;
    startTouchY = null;
    didDrag = false;
    selecting = false;
    velocity = 0;
    stopMomentum();
  };

  const handleClick = (event: MouseEvent) => {
    if (!options.onTap && !focus) {
      return;
    }

    if (now() < suppressClickUntil) {
      event.stopImmediatePropagation();
      return;
    }

    if (options.onTap) {
      options.onTap({ clientX: event.clientX, clientY: event.clientY });
    } else {
      focus?.();
    }
    event.stopImmediatePropagation();
  };

  target.addEventListener("touchstart", handleTouchStart, { capture: true, passive: true });
  target.addEventListener("touchmove", handleTouchMove, { capture: true, passive: false });
  target.addEventListener("touchend", handleTouchEnd, { capture: true, passive: false });
  target.addEventListener("touchcancel", handleTouchCancel, { capture: true, passive: true });
  target.addEventListener("click", handleClick, { capture: true });

  return () => {
    stopMomentum();
    clearLongPressTimer();
    target.removeEventListener("touchstart", handleTouchStart, { capture: true });
    target.removeEventListener("touchmove", handleTouchMove, { capture: true });
    target.removeEventListener("touchend", handleTouchEnd, { capture: true });
    target.removeEventListener("touchcancel", handleTouchCancel, { capture: true });
    target.removeEventListener("click", handleClick, { capture: true });
  };
}
