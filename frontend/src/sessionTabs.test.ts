import { describe, expect, it } from "vitest";
import { pickNextActiveSessionId, truncateSessionTabName } from "./sessionTabs";

describe("session tabs", () => {
  it("picks the next right tab when closing the active tab", () => {
    expect(pickNextActiveSessionId(["a", "b", "c"], "b")).toBe("c");
  });

  it("falls back left when closing the last tab", () => {
    expect(pickNextActiveSessionId(["a", "b"], "b")).toBe("a");
  });

  it("truncates chip labels around fifteen characters", () => {
    expect(truncateSessionTabName("Very long session title")).toBe("Very long sessi...");
  });
});
