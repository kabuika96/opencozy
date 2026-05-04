import { describe, expect, it } from "vitest";
import { shouldShowArrowPad } from "./terminalControls";

describe("terminal controls", () => {
  it("shows the arrow pad whenever native input is not focused", () => {
    expect(shouldShowArrowPad({
      keyboardFocused: false,
      terminalFallbackControlsVisible: false
    })).toBe(true);
  });

  it("keeps the arrow pad available during terminal fallback flows", () => {
    expect(shouldShowArrowPad({
      keyboardFocused: true,
      terminalFallbackControlsVisible: true
    })).toBe(true);
  });

  it("hides the arrow pad only while normal native typing is active", () => {
    expect(shouldShowArrowPad({
      keyboardFocused: true,
      terminalFallbackControlsVisible: false
    })).toBe(false);
  });
});
