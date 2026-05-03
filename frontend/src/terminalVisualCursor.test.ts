import { describe, expect, it } from "vitest";
import { getTerminalVisualCursorStyle } from "./terminalVisualCursor";

describe("terminal visual cursor", () => {
  it("positions the cursor from xterm buffer coordinates", () => {
    expect(
      getTerminalVisualCursorStyle({
        baseY: 20,
        cols: 80,
        cursorX: 10,
        cursorY: 4,
        hostLeft: 10,
        hostTop: 20,
        rows: 24,
        screenHeight: 480,
        screenLeft: 18,
        screenTop: 32,
        screenWidth: 800,
        viewportY: 20
      })
    ).toEqual({
      display: "block",
      height: "20px",
      transform: "translate(108px, 92px)",
      width: "2px"
    });
  });

  it("hides the cursor when the prompt row is scrolled out of view", () => {
    expect(
      getTerminalVisualCursorStyle({
        baseY: 20,
        cols: 80,
        cursorX: 10,
        cursorY: 4,
        hostLeft: 0,
        hostTop: 0,
        rows: 24,
        screenHeight: 480,
        screenLeft: 0,
        screenTop: 0,
        screenWidth: 800,
        viewportY: 0
      })
    ).toEqual({ display: "none" });
  });
});
