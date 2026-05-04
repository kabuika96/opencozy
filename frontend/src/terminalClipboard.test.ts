import { describe, expect, it } from "vitest";
import { normalizeTerminalCopyText, normalizeTerminalInput, writeTerminalClipboardText } from "./terminalClipboard";

describe("terminal clipboard", () => {
  it("normalizes pasted text into terminal enter bytes", () => {
    expect(normalizeTerminalInput("one\r\ntwo\nthree\rfour")).toBe("one\rtwo\rthree\rfour");
  });

  it("normalizes copied terminal text without changing content words", () => {
    expect(normalizeTerminalCopyText("one   \r\ntwo\t\nthree")).toBe("one\ntwo\nthree");
  });

  it("writes normalized terminal text through the Clipboard API when available", async () => {
    const writes: string[] = [];

    await expect(writeTerminalClipboardText("one   \r\ntwo\t", {
      navigator: {
        clipboard: {
          writeText: async (text) => {
            writes.push(text);
          }
        }
      }
    })).resolves.toBe(true);

    expect(writes).toEqual(["one\ntwo"]);
  });

  it("falls back to a temporary textarea selection when Clipboard API is unavailable", async () => {
    const actions: string[] = [];
    const textarea = {
      value: "",
      style: {} as Record<string, string>,
      select: () => actions.push("select"),
      setAttribute: (name: string, value: string) => actions.push(`attr:${name}:${value}`),
      setSelectionRange: (start: number, end: number) => actions.push(`range:${start}:${end}`)
    };

    await expect(writeTerminalClipboardText("copy me  ", {
      document: {
        body: {
          appendChild: () => actions.push("append"),
          removeChild: () => actions.push("remove")
        },
        createElement: () => textarea,
        execCommand: (command) => {
          actions.push(command);
          return true;
        }
      }
    })).resolves.toBe(true);

    expect(textarea.value).toBe("copy me");
    expect(actions).toEqual(["attr:readonly:", "append", "select", "range:0:7", "copy", "remove"]);
  });
});
