export function pickNextActiveSessionId(tabIds: string[], closingId: string): string | null {
  const closingIndex = tabIds.indexOf(closingId);
  const nextIds = tabIds.filter((id) => id !== closingId);
  if (nextIds.length === 0) {
    return null;
  }

  if (closingIndex < 0) {
    return nextIds[0] ?? null;
  }

  return nextIds[Math.min(closingIndex, nextIds.length - 1)] ?? null;
}

type ScrollableSessionTab = {
  scrollIntoView: (options?: ScrollIntoViewOptions) => void;
};

type SessionTabScroller = {
  querySelector: (selectors: string) => ScrollableSessionTab | null;
};

export function scrollActiveSessionTabIntoView(scroller: SessionTabScroller | null): boolean {
  const activeTab = scroller?.querySelector("[data-session-tab-active='true']") ?? null;
  if (!activeTab) {
    return false;
  }

  activeTab.scrollIntoView({ block: "nearest", inline: "nearest" });
  return true;
}

export function truncateSessionTabName(name: string, maxLength = 15): string {
  const trimmed = name.trim();
  if (trimmed.length <= maxLength) {
    return trimmed || "Session";
  }

  return `${trimmed.slice(0, maxLength)}...`;
}
