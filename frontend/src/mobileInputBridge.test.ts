import { describe, expect, it } from "vitest";
import {
  createMobileInputBridgePatch,
  createMobileInputBridgeSelectionPatch,
  createMobileInputBridgeState
} from "./mobileInputBridge";

describe("mobile input bridge", () => {
  it("emits inserted text", () => {
    expect(createMobileInputBridgePatch(createMobileInputBridgeState(), "abc", 3)).toEqual({
      data: "abc",
      state: { cursor: 3, value: "abc" }
    });
  });

  it("moves the terminal cursor when the native caret moves", () => {
    expect(createMobileInputBridgePatch({ cursor: 4, value: "abcd" }, "abcd", 2)).toEqual({
      data: "\u001b[D\u001b[D",
      state: { cursor: 2, value: "abcd" }
    });
  });

  it("inserts text at the native caret without moving unnecessarily", () => {
    expect(createMobileInputBridgePatch({ cursor: 2, value: "abcd" }, "abXcd", 3)).toEqual({
      data: "X",
      state: { cursor: 3, value: "abXcd" }
    });
  });

  it("moves to the edit point before deleting text after the native caret", () => {
    expect(createMobileInputBridgePatch({ cursor: 4, value: "abcd" }, "acd", 1)).toEqual({
      data: "\u001b[D\u001b[D\u001b[D\u001b[3~",
      state: { cursor: 1, value: "acd" }
    });
  });

  it("deletes selected text and inserts a replacement", () => {
    expect(createMobileInputBridgePatch({ cursor: 5, value: "hello" }, "hallo", 2)).toEqual({
      data: "\u001b[D\u001b[D\u001b[D\u001b[D\u001b[3~a",
      state: { cursor: 2, value: "hallo" }
    });
  });

  it("returns the terminal cursor to the native caret after a replacement", () => {
    expect(createMobileInputBridgePatch({ cursor: 5, value: "hello" }, "hallo", 1)).toEqual({
      data: "\u001b[D\u001b[D\u001b[D\u001b[D\u001b[3~a\u001b[D",
      state: { cursor: 1, value: "hallo" }
    });
  });

  it("clamps native cursor positions into the textarea value", () => {
    expect(createMobileInputBridgePatch({ cursor: 0, value: "" }, "abc", 99)).toEqual({
      data: "abc",
      state: { cursor: 3, value: "abc" }
    });
  });

  it("normalizes pasted newlines into terminal enter bytes", () => {
    expect(createMobileInputBridgePatch(createMobileInputBridgeState(), "a\nb", 3).data).toBe("a\rb");
  });

  it("does not move the terminal cursor while an unchanged native range is selected", () => {
    expect(createMobileInputBridgeSelectionPatch({ cursor: 5, value: "hello" }, "hello", 1, 4)).toBeNull();
  });

  it("still applies replacement text after a selected range changes", () => {
    expect(createMobileInputBridgeSelectionPatch({ cursor: 5, value: "hello" }, "hao", 2, 2)).toEqual({
      data: "\u001b[D\u001b[D\u001b[D\u001b[D\u001b[3~\u001b[3~\u001b[3~a",
      state: { cursor: 2, value: "hao" }
    });
  });
});
