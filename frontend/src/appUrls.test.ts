import { describe, expect, it } from "vitest";
import { buildLaunchUrl, buildOpenCozySessionSocketUrl, normalizeAppPath } from "./appUrls";

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

  it("builds an initial OpenCozy session socket URL with history replay", () => {
    expect(
      buildOpenCozySessionSocketUrl("session/1", {
        host: "opencozy.local",
        protocol: "https:"
      })
    ).toBe("wss://opencozy.local/api/open-cozy-sessions/session%2F1/socket");
  });

  it("can disable history replay for same-page reconnects", () => {
    expect(
      buildOpenCozySessionSocketUrl("session-1", {
        host: "10.0.0.158:5175",
        protocol: "http:"
      }, {
        replayHistory: false
      })
    ).toBe("ws://10.0.0.158:5175/api/open-cozy-sessions/session-1/socket?replay=0");
  });
});
