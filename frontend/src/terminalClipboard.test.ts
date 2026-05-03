import { describe, expect, it } from "vitest";
import { normalizeTerminalInput, readTerminalBufferText, type TerminalBufferLineLike } from "./terminalClipboard";

function buffer(lines: Array<TerminalBufferLineLike | undefined>) {
  return {
    length: lines.length,
    getLine(index: number) {
      return lines[index];
    }
  };
}

function line(text: string, isWrapped = false): TerminalBufferLineLike {
  return {
    isWrapped,
    translateToString(trimRight = false) {
      return trimRight ? text.trimEnd() : text;
    }
  };
}

describe("terminal clipboard", () => {
  it("reads scrollback text while preserving wrapped visual lines", () => {
    expect(readTerminalBufferText(buffer([
      line("first "),
      line("wrapped", true),
      line("line"),
      line(""),
      line("   ")
    ]))).toBe("first wrapped\nline");
  });

  it("normalizes pasted text into terminal enter bytes", () => {
    expect(normalizeTerminalInput("one\r\ntwo\nthree\rfour")).toBe("one\rtwo\rthree\rfour");
  });
});
