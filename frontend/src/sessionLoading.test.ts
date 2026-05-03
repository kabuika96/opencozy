import { describe, expect, it } from "vitest";
import { getSessionLoadingCopy } from "./sessionLoading";

describe("session loading copy", () => {
  it("uses Resume Picker language while opening sessions", () => {
    expect(getSessionLoadingCopy("resume", "initializing")).toEqual({
      title: "Opening Sessions",
      detail: "Starting the Resume Picker."
    });
  });

  it("distinguishes a blank terminal that is connected but waiting on Codex output", () => {
    expect(getSessionLoadingCopy("new", "waitingForOutput")).toEqual({
      title: "Waiting for Codex",
      detail: "The first output should appear shortly."
    });
  });

  it("uses OpenCozy Session language while attaching to the PTY stream", () => {
    expect(getSessionLoadingCopy("new", "connecting")).toEqual({
      title: "Connecting",
      detail: "Attaching to the OpenCozy Session."
    });
  });
});
