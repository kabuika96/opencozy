import { describe, expect, it } from "vitest";
import { buildShortcutUrl, normalizeShortcutPath } from "./appUrls.js";

describe("LAN app shortcut URLs", () => {
  it("normalizes empty paths to root", () => {
    expect(normalizeShortcutPath("")).toBe("/");
    expect(normalizeShortcutPath(undefined)).toBe("/");
  });

  it("adds a leading slash when needed", () => {
    expect(normalizeShortcutPath("dashboard")).toBe("/dashboard");
  });

  it("builds a launchable URL", () => {
    expect(
      buildShortcutUrl({
        protocol: "http",
        host: "192.168.1.50",
        port: 5173,
        path: "workspace"
      })
    ).toBe("http://192.168.1.50:5173/workspace");
  });
});
