import { describe, expect, it } from "vitest";
import { bindKeyboardReserve } from "./keyboardReserve";

class FakeTarget extends EventTarget {}

class FakeStyle {
  readonly values = new Map<string, string>();

  setProperty(name: string, value: string): void {
    this.values.set(name, value);
  }
}

function makeWindow(options: { coarse?: boolean; height?: number; width?: number; visualHeight?: number } = {}) {
  const style = new FakeStyle();
  const visualViewport = Object.assign(new FakeTarget(), {
    height: options.visualHeight ?? options.height ?? 844,
    offsetTop: 0
  });
  const win = Object.assign(new FakeTarget(), {
    document: {
      documentElement: {
        clientHeight: options.height ?? 844,
        style
      }
    },
    innerHeight: options.height ?? 844,
    innerWidth: options.width ?? 390,
    matchMedia: () => ({ matches: options.coarse ?? true }),
    navigator: { maxTouchPoints: options.coarse === false ? 0 : 1 },
    setTimeout: (callback: () => void) => {
      callback();
      return 1;
    },
    visualViewport
  });

  return { style, visualViewport, win };
}

describe("keyboard reserve", () => {
  it("adds a fallback keyboard reserve for touch devices when the viewport does not resize", () => {
    const input = new FakeTarget();
    const { style, win } = makeWindow();
    const cleanup = bindKeyboardReserve(input, win as unknown as Window);

    input.dispatchEvent(new Event("focus"));

    expect(style.values.get("--oc-keyboard-reserve")).toBe("371px");

    cleanup();
  });

  it("does not double reserve when the layout viewport has already shrunk", () => {
    const input = new FakeTarget();
    const { style, win } = makeWindow();
    const cleanup = bindKeyboardReserve(input, win as unknown as Window);

    win.innerHeight = 520;
    input.dispatchEvent(new Event("focus"));

    expect(style.values.get("--oc-keyboard-reserve")).toBe("0px");

    cleanup();
  });

  it("uses a measured visual viewport shrink when available", () => {
    const input = new FakeTarget();
    const { style, visualViewport, win } = makeWindow({ visualHeight: 844 });
    const cleanup = bindKeyboardReserve(input, win as unknown as Window);

    visualViewport.height = 500;
    input.dispatchEvent(new Event("focus"));

    expect(style.values.get("--oc-keyboard-reserve")).toBe("371px");

    cleanup();
  });
});
