import { Terminal, type ITerminalOptions } from "@xterm/xterm";

export type MobileTerminalTapPoint = {
  clientX: number;
  clientY: number;
};

export type MobileTerminalBufferPosition = {
  column: number;
  row: number;
};

export type MobileTerminalMouseEventType = "click" | "mousedown" | "mousemove" | "mouseup";

export function isMobileTerminalEnvironment(win: Window): boolean {
  return win.navigator.maxTouchPoints > 0 || win.matchMedia("(pointer: coarse)").matches;
}

export function createMobileTerminal(options: ITerminalOptions): Terminal {
  return new Terminal(options);
}

export function forwardTerminalTapFromOverlay({
  clientX,
  clientY,
  overlay,
  root
}: MobileTerminalTapPoint & {
  overlay: HTMLElement;
  root: HTMLElement;
}): boolean {
  const pressed = forwardTerminalMouseEventFromOverlay({
    clientX,
    clientY,
    overlay,
    root,
    type: "mousedown"
  });
  if (!pressed) {
    return false;
  }

  forwardTerminalMouseEventFromOverlay({
    clientX,
    clientY,
    overlay,
    root,
    type: "mouseup"
  });
  forwardTerminalMouseEventFromOverlay({
    clientX,
    clientY,
    overlay,
    root,
    type: "click"
  });
  return true;
}

export function forwardTerminalMouseEventFromOverlay({
  clientX,
  clientY,
  overlay,
  root,
  type
}: MobileTerminalTapPoint & {
  overlay: HTMLElement;
  root: HTMLElement;
  type: MobileTerminalMouseEventType;
}): boolean {
  const previousPointerEvents = overlay.style.pointerEvents;
  overlay.style.pointerEvents = "none";
  let target: Element | null = null;
  try {
    target = root.ownerDocument.elementFromPoint(clientX, clientY);
  } finally {
    overlay.style.pointerEvents = previousPointerEvents;
  }

  const window = root.ownerDocument.defaultView;
  const HtmlElement = window?.HTMLElement;
  const MouseEventCtor = window?.MouseEvent;
  if (!HtmlElement || !MouseEventCtor || !(target instanceof HtmlElement) || !root.contains(target) || target === overlay) {
    return false;
  }

  const isPressed = type === "mousedown" || type === "mousemove";
  const eventOptions: MouseEventInit = {
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: isPressed ? 1 : 0,
    clientX,
    clientY,
    view: window
  };

  target.dispatchEvent(new MouseEventCtor(type, eventOptions));
  return true;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function getTerminalBufferPositionFromPoint({
  clientX,
  clientY,
  root,
  terminal
}: MobileTerminalTapPoint & {
  root: HTMLElement;
  terminal: Terminal;
}): MobileTerminalBufferPosition | null {
  const screen = root.querySelector<HTMLElement>(".xterm-screen");
  if (!screen || terminal.cols <= 0 || terminal.rows <= 0) {
    return null;
  }

  const rect = screen.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const cellWidth = rect.width / terminal.cols;
  const cellHeight = rect.height / terminal.rows;
  const column = clamp(Math.floor((clientX - rect.left) / cellWidth), 0, terminal.cols - 1);
  const viewportRow = clamp(Math.floor((clientY - rect.top) / cellHeight), 0, terminal.rows - 1);

  return {
    column,
    row: terminal.buffer.active.viewportY + viewportRow
  };
}

function compareBufferPositions(left: MobileTerminalBufferPosition, right: MobileTerminalBufferPosition): number {
  if (left.row !== right.row) {
    return left.row - right.row;
  }

  return left.column - right.column;
}

export function selectTerminalRangeFromPoints({
  anchor,
  focus,
  root,
  terminal
}: {
  anchor: MobileTerminalTapPoint;
  focus: MobileTerminalTapPoint;
  root: HTMLElement;
  terminal: Terminal;
}): boolean {
  const anchorPosition = getTerminalBufferPositionFromPoint({ ...anchor, root, terminal });
  const focusPosition = getTerminalBufferPositionFromPoint({ ...focus, root, terminal });
  if (!anchorPosition || !focusPosition) {
    return false;
  }

  const isForward = compareBufferPositions(anchorPosition, focusPosition) <= 0;
  const start = isForward ? anchorPosition : focusPosition;
  const end = isForward ? focusPosition : anchorPosition;
  const exclusiveEndColumn = Math.min(terminal.cols, end.column + 1);
  const length = Math.max(1, (end.row - start.row) * terminal.cols + exclusiveEndColumn - start.column);

  terminal.select(start.column, start.row, length);
  return true;
}
