type TouchRoot = Pick<HTMLElement, "addEventListener" | "removeEventListener">;

type ScrollCandidate = {
  clientHeight?: number;
  matches?: (selector: string) => boolean;
  scrollHeight?: number;
  scrollTop?: number;
};

const SCROLLABLE_SELECTOR = ".sheet, [data-opencozy-scrollable='true']";

function touchY(event: TouchEvent): number | null {
  if (event.touches.length !== 1) {
    return null;
  }

  const touch = event.touches[0];
  return touch?.clientY ?? touch?.pageY ?? null;
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

function isScrollableCandidate(candidate: ScrollCandidate): candidate is Required<ScrollCandidate> {
  return (
    typeof candidate.clientHeight === "number" &&
    typeof candidate.scrollHeight === "number" &&
    typeof candidate.scrollTop === "number" &&
    candidate.scrollHeight > candidate.clientHeight &&
    candidate.matches?.(SCROLLABLE_SELECTOR) === true
  );
}

function findScrollable(event: TouchEvent): Required<ScrollCandidate> | null {
  for (const candidate of eventPath(event)) {
    if (isScrollableCandidate(candidate)) {
      return candidate;
    }
  }

  return null;
}

function canScroll(scrollable: Required<ScrollCandidate>, deltaY: number): boolean {
  if (deltaY > 0) {
    return scrollable.scrollTop + scrollable.clientHeight < scrollable.scrollHeight;
  }

  if (deltaY < 0) {
    return scrollable.scrollTop > 0;
  }

  return true;
}

export function bindOuterScrollLock(root: TouchRoot): () => void {
  let lastTouchY: number | null = null;

  const handleTouchStart = (event: TouchEvent) => {
    lastTouchY = touchY(event);
  };

  const handleTouchMove = (event: TouchEvent) => {
    const y = touchY(event);
    if (y === null || lastTouchY === null) {
      lastTouchY = y;
      preventOuterScroll(event);
      return;
    }

    const deltaY = lastTouchY - y;
    lastTouchY = y;
    const scrollable = findScrollable(event);
    if (scrollable && canScroll(scrollable, deltaY)) {
      return;
    }

    preventOuterScroll(event);
  };

  const handleTouchEnd = () => {
    lastTouchY = null;
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
