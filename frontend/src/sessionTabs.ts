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

export function truncateSessionTabName(name: string, maxLength = 15): string {
  const trimmed = name.trim();
  if (trimmed.length <= maxLength) {
    return trimmed || "Session";
  }

  return `${trimmed.slice(0, maxLength)}...`;
}
