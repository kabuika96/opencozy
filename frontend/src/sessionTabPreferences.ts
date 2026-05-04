import { pickNextActiveSessionId } from "./sessionTabs";
import type { OpenCozySessionSummary } from "./types";

const SESSION_TAB_PREFERENCES_KEY_PREFIX = "opencozy.sessionTabs.device.";
const LAST_CODEX_THREAD_ID_KEY_PREFIX = "opencozy.lastCodexThreadId.device.";

type PreferenceStorageReader = Pick<Storage, "getItem">;
type PreferenceStorageWriter = Pick<Storage, "removeItem" | "setItem">;

export type SessionTabPreferences = {
  activeSessionId: string | null;
  tabIds: string[];
};

const EMPTY_SESSION_TAB_PREFERENCES: SessionTabPreferences = {
  activeSessionId: null,
  tabIds: []
};

function deviceStorageKey(prefix: string, deviceId: string): string {
  return `${prefix}${encodeURIComponent(deviceId)}`;
}

function uniqueStringIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) {
    return [];
  }

  const seen = new Set<string>();
  const uniqueIds: string[] = [];
  for (const id of ids) {
    if (typeof id !== "string" || !id.trim() || seen.has(id)) {
      continue;
    }

    seen.add(id);
    uniqueIds.push(id);
  }

  return uniqueIds;
}

function sanitizeSessionTabPreferences(value: unknown): SessionTabPreferences {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return EMPTY_SESSION_TAB_PREFERENCES;
  }

  const record = value as Record<string, unknown>;
  const tabIds = uniqueStringIds(record.tabIds);
  const activeSessionId = typeof record.activeSessionId === "string" && tabIds.includes(record.activeSessionId)
    ? record.activeSessionId
    : tabIds[0] ?? null;

  return { activeSessionId, tabIds };
}

export function sessionTabPreferencesKey(deviceId: string): string {
  return deviceStorageKey(SESSION_TAB_PREFERENCES_KEY_PREFIX, deviceId);
}

export function lastCodexThreadIdKey(deviceId: string): string {
  return deviceStorageKey(LAST_CODEX_THREAD_ID_KEY_PREFIX, deviceId);
}

export function readSessionTabPreferences(storage: PreferenceStorageReader, deviceId: string): SessionTabPreferences {
  const raw = storage.getItem(sessionTabPreferencesKey(deviceId));
  if (!raw) {
    return EMPTY_SESSION_TAB_PREFERENCES;
  }

  try {
    return sanitizeSessionTabPreferences(JSON.parse(raw));
  } catch {
    return EMPTY_SESSION_TAB_PREFERENCES;
  }
}

export function writeSessionTabPreferences(
  storage: PreferenceStorageWriter,
  deviceId: string,
  preferences: SessionTabPreferences
): SessionTabPreferences {
  const sanitized = sanitizeSessionTabPreferences(preferences);
  if (sanitized.tabIds.length === 0) {
    storage.removeItem(sessionTabPreferencesKey(deviceId));
    return sanitized;
  }

  storage.setItem(sessionTabPreferencesKey(deviceId), JSON.stringify(sanitized));
  return sanitized;
}

export function reconcileSessionTabPreferences(
  preferences: SessionTabPreferences,
  sessions: OpenCozySessionSummary[]
): SessionTabPreferences {
  const availableSessionIds = new Set(sessions.map((session) => session.id));
  const tabIds = preferences.tabIds.filter((id) => availableSessionIds.has(id));
  const activeSessionId = preferences.activeSessionId && tabIds.includes(preferences.activeSessionId)
    ? preferences.activeSessionId
    : tabIds[0] ?? null;

  return { activeSessionId, tabIds };
}

export function addSessionTabPreference(
  preferences: SessionTabPreferences,
  sessionId: string
): SessionTabPreferences {
  const tabIds = preferences.tabIds.includes(sessionId) ? preferences.tabIds : [...preferences.tabIds, sessionId];
  return {
    activeSessionId: sessionId,
    tabIds
  };
}

export function removeSessionTabPreference(
  preferences: SessionTabPreferences,
  sessionId: string
): SessionTabPreferences {
  const tabIds = preferences.tabIds.filter((id) => id !== sessionId);
  const activeSessionId = preferences.activeSessionId === sessionId
    ? pickNextActiveSessionId(preferences.tabIds, sessionId)
    : preferences.activeSessionId;

  return {
    activeSessionId: activeSessionId && tabIds.includes(activeSessionId) ? activeSessionId : tabIds[0] ?? null,
    tabIds
  };
}

export function readLastCodexThreadId(storage: PreferenceStorageReader, deviceId: string): string | null {
  const value = storage.getItem(lastCodexThreadIdKey(deviceId));
  return value?.trim() || null;
}

export function writeLastCodexThreadId(storage: PreferenceStorageWriter, deviceId: string, codexThreadId: string | null): void {
  if (codexThreadId?.trim()) {
    storage.setItem(lastCodexThreadIdKey(deviceId), codexThreadId.trim());
    return;
  }

  storage.removeItem(lastCodexThreadIdKey(deviceId));
}
