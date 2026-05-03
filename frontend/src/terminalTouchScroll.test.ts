import { describe, expect, it } from "vitest";
import { bindTerminalTouchScroll } from "./terminalTouchScroll";

class FakeViewport extends EventTarget {
  clientHeight = 320;
  scrollHeight = 1200;
  scrollTop = 0;
}

class FakeTerminalHost extends EventTarget {
  constructor(private readonly viewport: FakeViewport | null) {
    super();
  }

  querySelector<T extends Element = Element>(selector: string): T | null {
    if (selector === ".xterm-viewport") {
      return this.viewport as unknown as T;
    }

    return null;
  }
}

class FakeTouchLayer extends EventTarget {}

function touchEvent(type: string, y: number, touches = [{ pageY: y }]): Event {
  const event = new Event(type, { bubbles: true, cancelable: type === "touchmove" });
  Object.defineProperty(event, "touches", { value: touches });
  return event;
}

describe("terminal touch scrolling", () => {
  it("scrolls xterm's viewport from a drag on terminal text", () => {
    const viewport = new FakeViewport();
    const host = new FakeTerminalHost(viewport);
    let xtermHandledMove = false;
    const cleanup = bindTerminalTouchScroll(host as unknown as HTMLElement);

    host.addEventListener("touchmove", () => {
      xtermHandledMove = true;
    });

    host.dispatchEvent(touchEvent("touchstart", 200));
    const move = touchEvent("touchmove", 154);
    host.dispatchEvent(move);

    expect(viewport.scrollTop).toBe(46);
    expect(move.defaultPrevented).toBe(true);
    expect(xtermHandledMove).toBe(false);

    cleanup();
  });

  it("removes listeners during cleanup", () => {
    const viewport = new FakeViewport();
    const host = new FakeTerminalHost(viewport);

    const cleanup = bindTerminalTouchScroll(host as unknown as HTMLElement);
    cleanup();

    host.dispatchEvent(touchEvent("touchstart", 200));
    host.dispatchEvent(touchEvent("touchmove", 150));

    expect(viewport.scrollTop).toBe(0);
  });

  it("can listen on a dedicated touch layer while scrolling the xterm viewport", () => {
    const viewport = new FakeViewport();
    const host = new FakeTerminalHost(viewport);
    const touchLayer = new FakeTouchLayer();

    const cleanup = bindTerminalTouchScroll(touchLayer as unknown as HTMLElement, host as unknown as HTMLElement);

    touchLayer.dispatchEvent(touchEvent("touchstart", 220));
    const move = touchEvent("touchmove", 172);
    touchLayer.dispatchEvent(move);

    expect(viewport.scrollTop).toBe(48);
    expect(move.defaultPrevented).toBe(true);

    cleanup();
  });

  it("focuses only after a completed tap on the terminal layer", () => {
    const viewport = new FakeViewport();
    const host = new FakeTerminalHost(viewport);
    const touchLayer = new FakeTouchLayer();
    let focusCount = 0;

    const cleanup = bindTerminalTouchScroll(touchLayer as unknown as HTMLElement, host as unknown as HTMLElement, () => {
      focusCount++;
    });

    touchLayer.dispatchEvent(touchEvent("touchstart", 220));
    expect(focusCount).toBe(0);

    touchLayer.dispatchEvent(touchEvent("touchend", 220, []));
    expect(focusCount).toBe(1);

    cleanup();
  });

  it("does not focus after a scroll gesture", () => {
    const viewport = new FakeViewport();
    const host = new FakeTerminalHost(viewport);
    const touchLayer = new FakeTouchLayer();
    let focusCount = 0;

    const cleanup = bindTerminalTouchScroll(touchLayer as unknown as HTMLElement, host as unknown as HTMLElement, () => {
      focusCount++;
    });

    touchLayer.dispatchEvent(touchEvent("touchstart", 220));
    touchLayer.dispatchEvent(touchEvent("touchmove", 180));
    touchLayer.dispatchEvent(touchEvent("touchend", 180, []));

    expect(focusCount).toBe(0);

    cleanup();
  });
});
