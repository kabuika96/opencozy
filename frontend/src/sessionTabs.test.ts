import { describe, expect, it } from "vitest";
import { pickNextActiveSessionId, scrollActiveSessionTabIntoView, truncateSessionTabName } from "./sessionTabs";

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

  it("scrolls the active session tab into view", () => {
    let scrollOptions: ScrollIntoViewOptions | undefined;
    const activeTab = {
      scrollIntoView: (options?: ScrollIntoViewOptions) => {
        scrollOptions = options;
      }
    };
    const scroller = {
      querySelector: (selector: string) => (
        selector === "[data-session-tab-active='true']" ? activeTab : null
      )
    };

    expect(scrollActiveSessionTabIntoView(scroller)).toBe(true);
    expect(scrollOptions).toEqual({ block: "nearest", inline: "nearest" });
  });

  it("does not scroll when there is no active session tab", () => {
    const scroller = {
      querySelector: () => null
    };

    expect(scrollActiveSessionTabIntoView(scroller)).toBe(false);
  });
});
