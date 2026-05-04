import { describe, expect, it } from "vitest";
import { shouldShowArrowPad } from "./terminalControls";

describe("terminal controls", () => {
  it("keeps the arrow pad available across native keyboard states", () => {
    expect(shouldShowArrowPad()).toBe(true);
  });
});
