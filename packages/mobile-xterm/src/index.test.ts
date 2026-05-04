import { describe, expect, it } from "vitest";
import {
  forwardTerminalMouseEventFromOverlay,
  forwardTerminalTapFromOverlay,
  getTerminalBufferPositionFromPoint,
  selectTerminalRangeFromPoints
} from "./index";

class FakeMouseEvent {
  readonly type: string;
  readonly options: MouseEventInit;

  constructor(type: string, options: MouseEventInit) {
    this.type = type;
    this.options = options;
  }
}

class FakeHTMLElement {
  readonly dispatched: FakeMouseEvent[] = [];
  readonly ownerDocument: FakeDocument;
  readonly style = {
    pointerEvents: "auto"
  };

  constructor(ownerDocument: FakeDocument) {
    this.ownerDocument = ownerDocument;
  }

  contains(target: unknown): boolean {
    return target instanceof FakeHTMLElement;
  }

  dispatchEvent(event: FakeMouseEvent): boolean {
    this.dispatched.push(event);
    return true;
  }
}

class FakeDocument {
  readonly defaultView = {
    HTMLElement: FakeHTMLElement,
    MouseEvent: FakeMouseEvent
  };

  target: FakeHTMLElement | null = null;

  elementFromPoint(): Element | null {
    return this.target as unknown as Element | null;
  }
}

class FakeScreen {
  getBoundingClientRect(): DOMRect {
    return {
      bottom: 100,
      height: 100,
      left: 10,
      right: 210,
      toJSON: () => undefined,
      top: 20,
      width: 200,
      x: 10,
      y: 20
    } as DOMRect;
  }
}

class FakeRoot {
  querySelector<T extends Element = Element>(selector: string): T | null {
    if (selector === ".xterm-screen") {
      return new FakeScreen() as unknown as T;
    }

    return null;
  }
}

function makeTerminal() {
  const selections: Array<{ column: number; row: number; length: number }> = [];

  return {
    buffer: {
      active: {
        viewportY: 40
      }
    },
    cols: 20,
    rows: 10,
    select: (column: number, row: number, length: number) => {
      selections.push({ column, row, length });
    },
    selections
  };
}

describe("mobile xterm helpers", () => {
  it("forwards overlay mouse events through the underlying terminal element", () => {
    const document = new FakeDocument();
    const root = new FakeHTMLElement(document);
    const overlay = new FakeHTMLElement(document);
    const target = new FakeHTMLElement(document);
    document.target = target;

    expect(forwardTerminalMouseEventFromOverlay({
      clientX: 12,
      clientY: 34,
      overlay: overlay as unknown as HTMLElement,
      root: root as unknown as HTMLElement,
      type: "mousedown"
    })).toBe(true);

    expect(overlay.style.pointerEvents).toBe("auto");
    expect(target.dispatched).toHaveLength(1);
    expect(target.dispatched[0]?.type).toBe("mousedown");
    expect(target.dispatched[0]?.options.buttons).toBe(1);
  });

  it("forwards taps as press, release, and click events", () => {
    const document = new FakeDocument();
    const root = new FakeHTMLElement(document);
    const overlay = new FakeHTMLElement(document);
    const target = new FakeHTMLElement(document);
    document.target = target;

    expect(forwardTerminalTapFromOverlay({
      clientX: 12,
      clientY: 34,
      overlay: overlay as unknown as HTMLElement,
      root: root as unknown as HTMLElement
    })).toBe(true);

    expect(target.dispatched.map((event) => event.type)).toEqual(["mousedown", "mouseup", "click"]);
  });

  it("does not forward overlay taps when no underlying terminal element exists", () => {
    const document = new FakeDocument();
    const root = new FakeHTMLElement(document);
    const overlay = new FakeHTMLElement(document);

    expect(forwardTerminalTapFromOverlay({
      clientX: 12,
      clientY: 34,
      overlay: overlay as unknown as HTMLElement,
      root: root as unknown as HTMLElement
    })).toBe(false);
    expect(overlay.style.pointerEvents).toBe("auto");
  });

  it("maps client points to terminal buffer positions", () => {
    const position = getTerminalBufferPositionFromPoint({
      clientX: 36,
      clientY: 45,
      root: new FakeRoot() as unknown as HTMLElement,
      terminal: makeTerminal() as never
    });

    expect(position).toEqual({ column: 2, row: 42 });
  });

  it("selects a public xterm range from touch points", () => {
    const terminal = makeTerminal();

    expect(selectTerminalRangeFromPoints({
      anchor: { clientX: 36, clientY: 45 },
      focus: { clientX: 86, clientY: 65 },
      root: new FakeRoot() as unknown as HTMLElement,
      terminal: terminal as never
    })).toBe(true);

    expect(terminal.selections).toEqual([{ column: 2, row: 42, length: 46 }]);
  });

  it("normalizes reversed drags before selecting", () => {
    const terminal = makeTerminal();

    selectTerminalRangeFromPoints({
      anchor: { clientX: 86, clientY: 65 },
      focus: { clientX: 36, clientY: 45 },
      root: new FakeRoot() as unknown as HTMLElement,
      terminal: terminal as never
    });

    expect(terminal.selections).toEqual([{ column: 2, row: 42, length: 46 }]);
  });
});
