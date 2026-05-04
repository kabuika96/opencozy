import { describe, expect, it } from "vitest";
import { readMobileTerminalPreferences, writeMobileTerminalPreference } from "./mobileTerminalPreferences";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("mobile terminal preferences", () => {
  it("enables autocorrect and autocapitalization by default", () => {
    expect(readMobileTerminalPreferences(new MemoryStorage())).toEqual({
      autocapitalization: true,
      autocorrect: true
    });
  });

  it("stores each preference independently", () => {
    const storage = new MemoryStorage();

    expect(writeMobileTerminalPreference(storage, "autocorrect", false)).toEqual({
      autocapitalization: true,
      autocorrect: false
    });
    expect(writeMobileTerminalPreference(storage, "autocapitalization", false)).toEqual({
      autocapitalization: false,
      autocorrect: false
    });
  });
});
