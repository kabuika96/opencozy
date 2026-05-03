import { describe, expect, it } from "vitest";
import { buildTerminalEnv, extractResumePickerSelectionText, sendSerializedMessage, splitTerminalOutput } from "./terminalSessions.js";

describe("terminal session environment", () => {
  it("forces a color-capable terminal environment for Codex PTYs", () => {
    expect(
      buildTerminalEnv({
        PATH: "/usr/bin",
        TERM: "dumb",
        COLORTERM: "",
        NO_COLOR: "1",
        FORCE_COLOR: "0",
        CLICOLOR: "0",
        CLICOLOR_FORCE: "0",
        CI: "1",
        CODEX_CI: "1"
      })
    ).toEqual({
      PATH: "/usr/bin",
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
      FORCE_COLOR: "1",
      CLICOLOR: "1",
      CLICOLOR_FORCE: "1"
    });
  });
});

describe("terminal session socket delivery", () => {
  it("splits large terminal output into bounded WebSocket payloads", () => {
    const chunks = splitTerminalOutput("x".repeat(150_000));

    expect(chunks.join("")).toHaveLength(150_000);
    expect(chunks).toHaveLength(3);
    expect(chunks.every((chunk) => chunk.length <= 64_000)).toBe(true);
  });

  it("treats a send failure as a closed socket instead of throwing", () => {
    const socket = {
      OPEN: 1,
      readyState: 1,
      send: () => {
        throw new Error("socket closed");
      }
    };

    expect(sendSerializedMessage(socket, "{}")).toBe(false);
  });

  it("reports async send callback errors without throwing", () => {
    let reported = false;
    const socket = {
      OPEN: 1,
      readyState: 1,
      send: (_payload: string, callback: (error?: Error) => void) => {
        callback(new Error("socket closed"));
      }
    };

    expect(sendSerializedMessage(socket, "{}", () => {
      reported = true;
    })).toBe(true);
    expect(reported).toBe(true);
  });
});

describe("resume picker selection parsing", () => {
  it("extracts the highlighted picker row from ANSI reverse-video output", () => {
    expect(extractResumePickerSelectionText("old\r\n\u001b[7m  Selected Session   /work  \u001b[0m\r\nnext")).toBe("Selected Session /work");
  });

  it("falls back to visible selected row markers when reverse-video output is absent", () => {
    expect(extractResumePickerSelectionText("  Other Session\r\n\u203a Selected Session\r\n")).toBe("\u203a Selected Session");
  });
});
