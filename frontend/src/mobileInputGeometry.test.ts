import { describe, expect, it } from "vitest";
import { getMobileInputGeometry } from "./mobileInputGeometry";

const baseInput = {
  cols: 80,
  cursorX: 15,
  cursorY: 20,
  hostLeft: 10,
  hostTop: 20,
  inputCursor: 5,
  inputLength: 5,
  rows: 24,
  screenHeight: 480,
  screenLeft: 18,
  screenTop: 28,
  screenWidth: 800
};

describe("mobile input geometry", () => {
  it("aligns the native input layer to the terminal text start", () => {
    expect(getMobileInputGeometry(baseInput)).toEqual({
      height: 20,
      left: 8,
      lineHeight: 20,
      textIndent: 100,
      top: 408,
      width: 800
    });
  });

  it("covers wrapped input rows from the inferred text start", () => {
    expect(getMobileInputGeometry({
      ...baseInput,
      cursorX: 10,
      cursorY: 21,
      inputCursor: 20,
      inputLength: 30
    })).toEqual({
      height: 40,
      left: 8,
      lineHeight: 20,
      textIndent: 700,
      top: 408,
      width: 800
    });
  });

  it("covers the caret row when the caret wraps just past the last character", () => {
    expect(getMobileInputGeometry({
      ...baseInput,
      cols: 80,
      cursorX: 0,
      cursorY: 21,
      inputCursor: 10,
      inputLength: 10
    })).toEqual({
      height: 40,
      left: 8,
      lineHeight: 20,
      textIndent: 700,
      top: 408,
      width: 800
    });
  });

  it("clamps the native input cursor before inferring wrapped rows", () => {
    expect(getMobileInputGeometry({
      ...baseInput,
      cursorX: 18,
      inputCursor: 99,
      inputLength: 8
    })).toEqual({
      height: 20,
      left: 8,
      lineHeight: 20,
      textIndent: 100,
      top: 408,
      width: 800
    });
  });

  it("keeps an empty input target at the terminal cursor", () => {
    expect(getMobileInputGeometry({
      ...baseInput,
      cursorX: 22,
      inputCursor: 0,
      inputLength: 0
    })).toEqual({
      height: 20,
      left: 8,
      lineHeight: 20,
      textIndent: 220,
      top: 408,
      width: 800
    });
  });

  it("returns null when terminal dimensions are unavailable", () => {
    expect(getMobileInputGeometry({ ...baseInput, cols: 0 })).toBeNull();
  });
});
