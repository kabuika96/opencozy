import { describe, expect, it } from "vitest";
import {
  addSessionTabPreference,
  readLastCodexThreadId,
  readSessionTabPreferences,
  reconcileSessionTabPreferences,
  removeSessionTabPreference,
  sessionTabPreferencesKey,
  writeLastCodexThreadId,
  writeSessionTabPreferences
} from "./sessionTabPreferences";
import type { OpenCozySessionSummary } from "./types";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

function session(id: string): OpenCozySessionSummary {
  return {
    args: [],
    codexThreadId: null,
    command: "codex",
    createdAt: "2026-05-04T00:00:00.000Z",
    cwd: "/tmp",
    deviceId: "device-1",
    exitCode: null,
    id,
    mode: "new",
    name: id,
    status: "running",
    updatedAt: "2026-05-04T00:00:00.000Z"
  };
}

describe("session tab preferences", () => {
  it("stores active tabs under a device-scoped key", () => {
    const storage = new MemoryStorage();

    writeSessionTabPreferences(storage, "phone", { activeSessionId: "phone-session", tabIds: ["phone-session"] });
    writeSessionTabPreferences(storage, "desktop", { activeSessionId: "desktop-session", tabIds: ["desktop-session"] });

    expect(readSessionTabPreferences(storage, "phone")).toEqual({
      activeSessionId: "phone-session",
      tabIds: ["phone-session"]
    });
    expect(readSessionTabPreferences(storage, "desktop")).toEqual({
      activeSessionId: "desktop-session",
      tabIds: ["desktop-session"]
    });
  });

  it("does not restore a legacy global active session id", () => {
    const storage = new MemoryStorage();
    storage.setItem("opencozy.lastOpenCozySessionId", "other-device-session");

    expect(readSessionTabPreferences(storage, "phone")).toEqual({ activeSessionId: null, tabIds: [] });
  });

  it("reconciles stored tabs without appending unrelated listed sessions", () => {
    const preferences = {
      activeSessionId: "b",
      tabIds: ["stale", "b"]
    };

    expect(reconcileSessionTabPreferences(preferences, [session("a"), session("b"), session("c")])).toEqual({
      activeSessionId: "b",
      tabIds: ["b"]
    });
  });

  it("keeps the active tab valid when adding and removing tabs", () => {
    const withAdded = addSessionTabPreference({ activeSessionId: null, tabIds: [] }, "a");
    expect(addSessionTabPreference(withAdded, "b")).toEqual({ activeSessionId: "b", tabIds: ["a", "b"] });
    expect(removeSessionTabPreference({ activeSessionId: "b", tabIds: ["a", "b", "c"] }, "b")).toEqual({
      activeSessionId: "c",
      tabIds: ["a", "c"]
    });
  });

  it("stores resume-last Codex thread ids per device", () => {
    const storage = new MemoryStorage();

    writeLastCodexThreadId(storage, "phone", "phone-thread");
    writeLastCodexThreadId(storage, "desktop", "desktop-thread");

    expect(readLastCodexThreadId(storage, "phone")).toBe("phone-thread");
    expect(readLastCodexThreadId(storage, "desktop")).toBe("desktop-thread");
    expect(storage.values.has(sessionTabPreferencesKey("phone"))).toBe(false);
  });
});
