import { afterEach, describe, expect, it, vi } from "vitest";
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

function touchEvent(
  type: string,
  y: number,
  touches = [{ clientX: 24, clientY: y, pageX: 24, pageY: y }],
  cancelable = type === "touchmove"
): Event {
  const event = new Event(type, { bubbles: true, cancelable });
  Object.defineProperty(event, "touches", { value: touches });
  Object.defineProperty(event, "changedTouches", { value: touches });
  return event;
}

function clickEvent(x: number, y: number): Event {
  const event = new Event("click", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clientX", { value: x });
  Object.defineProperty(event, "clientY", { value: y });
  return event;
}

describe("terminal touch scrolling", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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

  it("notifies when a touch drag scrolls the terminal viewport", () => {
    const viewport = new FakeViewport();
    const host = new FakeTerminalHost(viewport);
    const touchLayer = new FakeTouchLayer();
    let userScrollCount = 0;

    const cleanup = bindTerminalTouchScroll(
      touchLayer as unknown as HTMLElement,
      host as unknown as HTMLElement,
      undefined,
      {
        onUserScroll: () => {
          userScrollCount++;
        }
      }
    );

    touchLayer.dispatchEvent(touchEvent("touchstart", 220));
    touchLayer.dispatchEvent(touchEvent("touchmove", 172));

    expect(userScrollCount).toBe(1);

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

  it("reports completed tap coordinates when requested", () => {
    const viewport = new FakeViewport();
    const host = new FakeTerminalHost(viewport);
    const touchLayer = new FakeTouchLayer();
    const taps: Array<{ clientX: number; clientY: number }> = [];

    const cleanup = bindTerminalTouchScroll(
      touchLayer as unknown as HTMLElement,
      host as unknown as HTMLElement,
      undefined,
      {
        onTap: (point) => taps.push(point)
      }
    );

    touchLayer.dispatchEvent(touchEvent("touchstart", 220, [{ clientX: 33, clientY: 220, pageX: 33, pageY: 220 }]));
    touchLayer.dispatchEvent(touchEvent("touchend", 220, [{ clientX: 33, clientY: 220, pageX: 33, pageY: 220 }]));

    expect(taps).toEqual([{ clientX: 33, clientY: 220 }]);

    cleanup();
  });

  it("suppresses the synthetic click after a completed touch tap", () => {
    const viewport = new FakeViewport();
    const host = new FakeTerminalHost(viewport);
    const touchLayer = new FakeTouchLayer();
    const taps: Array<{ clientX: number; clientY: number }> = [];

    const cleanup = bindTerminalTouchScroll(
      touchLayer as unknown as HTMLElement,
      host as unknown as HTMLElement,
      undefined,
      {
        onTap: (point) => taps.push(point)
      }
    );

    touchLayer.dispatchEvent(touchEvent("touchstart", 220, [{ clientX: 33, clientY: 220, pageX: 33, pageY: 220 }]));
    touchLayer.dispatchEvent(touchEvent("touchend", 220, [{ clientX: 33, clientY: 220, pageX: 33, pageY: 220 }]));
    touchLayer.dispatchEvent(clickEvent(33, 220));

    expect(taps).toEqual([{ clientX: 33, clientY: 220 }]);

    cleanup();
  });

  it("prevents the browser tap event after a handled touch tap", () => {
    const viewport = new FakeViewport();
    const host = new FakeTerminalHost(viewport);
    const touchLayer = new FakeTouchLayer();

    const cleanup = bindTerminalTouchScroll(
      touchLayer as unknown as HTMLElement,
      host as unknown as HTMLElement,
      undefined,
      {
        onTap: () => undefined
      }
    );

    touchLayer.dispatchEvent(touchEvent("touchstart", 220));
    const end = touchEvent("touchend", 220, [], true);
    touchLayer.dispatchEvent(end);

    expect(end.defaultPrevented).toBe(true);

    cleanup();
  });

  it("still reports direct click coordinates without a preceding touch", () => {
    const viewport = new FakeViewport();
    const host = new FakeTerminalHost(viewport);
    const touchLayer = new FakeTouchLayer();
    const taps: Array<{ clientX: number; clientY: number }> = [];

    const cleanup = bindTerminalTouchScroll(
      touchLayer as unknown as HTMLElement,
      host as unknown as HTMLElement,
      undefined,
      {
        onTap: (point) => taps.push(point)
      }
    );

    touchLayer.dispatchEvent(clickEvent(44, 210));

    expect(taps).toEqual([{ clientX: 44, clientY: 210 }]);

    cleanup();
  });

  it("turns a long press drag into selection callbacks instead of scroll", () => {
    vi.useFakeTimers();
    const viewport = new FakeViewport();
    const host = new FakeTerminalHost(viewport);
    const touchLayer = new FakeTouchLayer();
    const events: string[] = [];

    const cleanup = bindTerminalTouchScroll(
      touchLayer as unknown as HTMLElement,
      host as unknown as HTMLElement,
      undefined,
      {
        onSelectionEnd: (point) => events.push(`end:${point.clientY}`),
        onSelectionMove: (point) => events.push(`move:${point.clientY}`),
        onSelectionStart: (point) => events.push(`start:${point.clientY}`)
      }
    );

    touchLayer.dispatchEvent(touchEvent("touchstart", 220));
    vi.advanceTimersByTime(420);
    const move = touchEvent("touchmove", 172);
    touchLayer.dispatchEvent(move);
    touchLayer.dispatchEvent(touchEvent("touchend", 172, [{ clientX: 24, clientY: 172, pageX: 24, pageY: 172 }]));

    expect(events).toEqual(["start:220", "move:172", "end:172"]);
    expect(viewport.scrollTop).toBe(0);
    expect(move.defaultPrevented).toBe(true);

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
