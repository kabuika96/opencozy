type TouchRoot = Pick<HTMLElement, "addEventListener" | "removeEventListener">;

type ScrollCandidate = {
  clientHeight?: number;
  clientWidth?: number;
  getAttribute?: (name: string) => string | null;
  isContentEditable?: boolean;
  matches?: (selector: string) => boolean;
  tagName?: string;
  type?: string;
  scrollHeight?: number;
  scrollLeft?: number;
  scrollWidth?: number;
  scrollTop?: number;
};

const SCROLLABLE_SELECTOR = ".sheet, [data-opencozy-scrollable='true']";
const NON_TEXT_INPUT_TYPES = new Set([
  "button",
  "checkbox",
  "color",
  "file",
  "hidden",
  "image",
  "radio",
  "range",
  "reset",
  "submit"
]);

type TouchPoint = {
  x: number;
  y: number;
};

type HorizontalScrollableCandidate = ScrollCandidate & {
  clientWidth: number;
  scrollLeft: number;
  scrollWidth: number;
};

type VerticalScrollableCandidate = ScrollCandidate & {
  clientHeight: number;
  scrollHeight: number;
  scrollTop: number;
};

function touchPoint(event: TouchEvent): TouchPoint | null {
  if (event.touches.length !== 1) {
    return null;
  }

  const touch = event.touches[0];
  const x = touch?.clientX ?? touch?.pageX ?? null;
  const y = touch?.clientY ?? touch?.pageY ?? null;
  return x === null || y === null ? null : { x, y };
}

function preventOuterScroll(event: TouchEvent): void {
  if (event.cancelable) {
    event.preventDefault();
  }
}

function eventPath(event: Event): ScrollCandidate[] {
  const path = event.composedPath?.() ?? [];
  return path as ScrollCandidate[];
}

function isNativeTextEditingCandidate(candidate: ScrollCandidate): boolean {
  const tagName = candidate.tagName?.toLowerCase();
  if (tagName === "textarea") {
    return true;
  }

  if (tagName === "input") {
    const type = (candidate.getAttribute?.("type") ?? candidate.type ?? "text").toLowerCase();
    return !NON_TEXT_INPUT_TYPES.has(type);
  }

  return (
    candidate.isContentEditable === true ||
    candidate.matches?.("[contenteditable='true'], [contenteditable='plaintext-only']") === true
  );
}

function hasNativeTextEditor(event: TouchEvent): boolean {
  return eventPath(event).some(isNativeTextEditingCandidate);
}

function matchesScrollableSelector(candidate: ScrollCandidate): boolean {
  return candidate.matches?.(SCROLLABLE_SELECTOR) === true;
}

function isHorizontalScrollableCandidate(candidate: ScrollCandidate): candidate is HorizontalScrollableCandidate {
  return (
    matchesScrollableSelector(candidate) &&
    typeof candidate.clientWidth === "number" &&
    typeof candidate.scrollLeft === "number" &&
    typeof candidate.scrollWidth === "number" &&
    candidate.scrollWidth > candidate.clientWidth
  );
}

function isVerticalScrollableCandidate(candidate: ScrollCandidate): candidate is VerticalScrollableCandidate {
  return (
    matchesScrollableSelector(candidate) &&
    typeof candidate.clientHeight === "number" &&
    typeof candidate.scrollHeight === "number" &&
    typeof candidate.scrollTop === "number" &&
    candidate.scrollHeight > candidate.clientHeight
  );
}

function findHorizontalScrollable(event: TouchEvent): HorizontalScrollableCandidate | null {
  for (const candidate of eventPath(event)) {
    if (isHorizontalScrollableCandidate(candidate)) {
      return candidate;
    }
  }

  return null;
}

function findVerticalScrollable(event: TouchEvent): VerticalScrollableCandidate | null {
  for (const candidate of eventPath(event)) {
    if (isVerticalScrollableCandidate(candidate)) {
      return candidate;
    }
  }

  return null;
}

function canScrollHorizontal(scrollable: HorizontalScrollableCandidate, deltaX: number): boolean {
  if (deltaX > 0) {
    return scrollable.scrollLeft + scrollable.clientWidth < scrollable.scrollWidth;
  }

  if (deltaX < 0) {
    return scrollable.scrollLeft > 0;
  }

  return true;
}

function canScrollVertical(scrollable: VerticalScrollableCandidate, deltaY: number): boolean {
  if (deltaY > 0) {
    return scrollable.scrollTop + scrollable.clientHeight < scrollable.scrollHeight;
  }

  if (deltaY < 0) {
    return scrollable.scrollTop > 0;
  }

  return true;
}

export function bindOuterScrollLock(root: TouchRoot): () => void {
  let lastTouchPoint: TouchPoint | null = null;

  const handleTouchStart = (event: TouchEvent) => {
    lastTouchPoint = touchPoint(event);
  };

  const handleTouchMove = (event: TouchEvent) => {
    const point = touchPoint(event);
    if (hasNativeTextEditor(event)) {
      lastTouchPoint = point;
      return;
    }

    if (point === null || lastTouchPoint === null) {
      lastTouchPoint = point;
      preventOuterScroll(event);
      return;
    }

    const deltaX = lastTouchPoint.x - point.x;
    const deltaY = lastTouchPoint.y - point.y;
    lastTouchPoint = point;
    const horizontalIntent = Math.abs(deltaX) > Math.abs(deltaY);
    const horizontalScrollable = horizontalIntent ? findHorizontalScrollable(event) : null;
    if (horizontalScrollable && canScrollHorizontal(horizontalScrollable, deltaX)) {
      return;
    }

    const verticalScrollable = horizontalIntent ? null : findVerticalScrollable(event);
    if (verticalScrollable && canScrollVertical(verticalScrollable, deltaY)) {
      return;
    }

    preventOuterScroll(event);
  };

  const handleTouchEnd = () => {
    lastTouchPoint = null;
  };

  root.addEventListener("touchstart", handleTouchStart, { passive: true });
  root.addEventListener("touchmove", handleTouchMove, { passive: false });
  root.addEventListener("touchend", handleTouchEnd, { passive: true });
  root.addEventListener("touchcancel", handleTouchEnd, { passive: true });

  return () => {
    root.removeEventListener("touchstart", handleTouchStart);
    root.removeEventListener("touchmove", handleTouchMove);
    root.removeEventListener("touchend", handleTouchEnd);
    root.removeEventListener("touchcancel", handleTouchEnd);
  };
}
