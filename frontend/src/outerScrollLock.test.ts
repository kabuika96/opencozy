import { describe, expect, it } from "vitest";
import { bindOuterScrollLock } from "./outerScrollLock";

class FakeRoot extends EventTarget {}

class FakeScrollable {
  constructor(
    readonly selectorMatch: boolean,
    public scrollTop: number,
    readonly clientHeight: number,
    readonly scrollHeight: number
  ) {}

  matches(): boolean {
    return this.selectorMatch;
  }
}

function touchEvent(type: string, y: number, path: unknown[]): Event {
  const event = new Event(type, { bubbles: true, cancelable: type === "touchmove" });
  Object.defineProperty(event, "touches", { value: [{ clientY: y, pageY: y }] });
  Object.defineProperty(event, "composedPath", { value: () => path });
  return event;
}

describe("outer scroll lock", () => {
  it("prevents touchmove gestures from scrolling the document", () => {
    const root = new FakeRoot();
    const cleanup = bindOuterScrollLock(root as unknown as HTMLElement);

    root.dispatchEvent(touchEvent("touchstart", 180, [root]));
    const move = touchEvent("touchmove", 140, [root]);
    root.dispatchEvent(move);

    expect(move.defaultPrevented).toBe(true);

    cleanup();
  });

  it("allows a sheet to scroll internally when it has room in the drag direction", () => {
    const root = new FakeRoot();
    const sheet = new FakeScrollable(true, 20, 100, 260);
    const cleanup = bindOuterScrollLock(root as unknown as HTMLElement);

    root.dispatchEvent(touchEvent("touchstart", 180, [sheet, root]));
    const move = touchEvent("touchmove", 140, [sheet, root]);
    root.dispatchEvent(move);

    expect(move.defaultPrevented).toBe(false);

    cleanup();
  });

  it("prevents a sheet boundary drag from leaking to the document", () => {
    const root = new FakeRoot();
    const sheet = new FakeScrollable(true, 160, 100, 260);
    const cleanup = bindOuterScrollLock(root as unknown as HTMLElement);

    root.dispatchEvent(touchEvent("touchstart", 180, [sheet, root]));
    const move = touchEvent("touchmove", 140, [sheet, root]);
    root.dispatchEvent(move);

    expect(move.defaultPrevented).toBe(true);

    cleanup();
  });
});
