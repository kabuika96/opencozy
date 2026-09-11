import { describe, expect, it } from "vitest";
import { liteHarnessSystemInstructions, liteHarnessSystemConfigs } from "../src/config/liteharnessSystemConfig.js";

describe("Opencozy system configs", () => {
  it("renders stable mobile html instructions independently of user messages", () => {
    const prompt = liteHarnessSystemInstructions();

    expect(liteHarnessSystemInstructions()).toBe(prompt);
    expect(prompt).toContain(`<liteharness-system-config name="${liteHarnessSystemConfigs.harnessReplyContract.name}">`);
    expect(prompt).toContain("mobile-friendly HTML fragments");
    expect(prompt).toContain("Brevity applies to presentation, not reasoning, task scope, or verification");
    expect(prompt).toContain("Final answers must stand alone");
    expect(prompt).toContain("Distinguish completed, verified, queued, and blocked work");
    expect(prompt).toContain("Use a restrained palette");
    expect(prompt).toContain("Interim, progress, and non-final replies should be low-profile");
    expect(prompt).toContain("lh-html-muted");
    expect(prompt).toContain("lh-html-ok");
    expect(prompt).toContain("Use semantic classes instead of inline color/styles");
    expect(prompt).toContain("Do not use Markdown as the primary format");
  });
});
