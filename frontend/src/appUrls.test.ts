import { describe, expect, it } from "vitest";
import { buildLaunchUrl, normalizeAppPath } from "./appUrls";

describe("launch URLs", () => {
  it("uses root for blank paths", () => {
    expect(normalizeAppPath("  ")).toBe("/");
  });

  it("keeps explicit slash paths", () => {
    expect(normalizeAppPath("/api/health")).toBe("/api/health");
  });

  it("builds a LAN app URL", () => {
    expect(
      buildLaunchUrl({
        protocol: "http",
        host: "opencozy.local",
        port: 5173,
        path: "notes"
      })
    ).toBe("http://opencozy.local:5173/notes");
  });
});
