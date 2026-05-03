import { describe, expect, it } from "vitest";
import { normalizeTerminalInput } from "./terminalClipboard";

describe("terminal clipboard", () => {
  it("normalizes pasted text into terminal enter bytes", () => {
    expect(normalizeTerminalInput("one\r\ntwo\nthree\rfour")).toBe("one\rtwo\rthree\rfour");
  });
});
