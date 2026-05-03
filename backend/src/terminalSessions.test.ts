import { describe, expect, it } from "vitest";
import { buildTerminalEnv, sendSerializedMessage } from "./terminalSessions.js";

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
});
