import { normalizeTerminalInput } from "./terminalClipboard";

export type MobileInputBridgeState = {
  cursor: number;
  value: string;
};

export type MobileInputBridgePatch = {
  data: string;
  state: MobileInputBridgeState;
};

const DELETE_SEQUENCE = "\u001b[3~";
const LEFT_SEQUENCE = "\u001b[D";
const RIGHT_SEQUENCE = "\u001b[C";

export function createMobileInputBridgeState(): MobileInputBridgeState {
  return { cursor: 0, value: "" };
}

function repeatSequence(sequence: string, count: number): string {
  return count > 0 ? sequence.repeat(count) : "";
}

function moveCursor(from: number, to: number): string {
  if (to < from) {
    return repeatSequence(LEFT_SEQUENCE, from - to);
  }

  return repeatSequence(RIGHT_SEQUENCE, to - from);
}

function commonPrefixLength(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index++) {
    if (left[index] !== right[index]) {
      return index;
    }
  }

  return length;
}

function commonSuffixLength(left: string, right: string, prefixLength: number): number {
  const maxLength = Math.min(left.length, right.length) - prefixLength;
  for (let index = 0; index < maxLength; index++) {
    if (left[left.length - 1 - index] !== right[right.length - 1 - index]) {
      return index;
    }
  }

  return maxLength;
}

export function createMobileInputBridgePatch(
  previous: MobileInputBridgeState,
  nextValue: string,
  nextCursor: number
): MobileInputBridgePatch {
  const cursor = Math.max(0, Math.min(nextCursor, nextValue.length));

  if (previous.value === nextValue) {
    return {
      data: moveCursor(previous.cursor, cursor),
      state: { cursor, value: nextValue }
    };
  }

  const prefixLength = commonPrefixLength(previous.value, nextValue);
  const suffixLength = commonSuffixLength(previous.value, nextValue, prefixLength);
  const previousChangeEnd = previous.value.length - suffixLength;
  const nextChangeEnd = nextValue.length - suffixLength;
  const deletedCount = Math.max(0, previousChangeEnd - prefixLength);
  const inserted = nextValue.slice(prefixLength, nextChangeEnd);
  const cursorAfterEdit = prefixLength + inserted.length;

  const data = [
    moveCursor(previous.cursor, prefixLength),
    repeatSequence(DELETE_SEQUENCE, deletedCount),
    normalizeTerminalInput(inserted),
    moveCursor(cursorAfterEdit, cursor)
  ].join("");

  return {
    data,
    state: { cursor, value: nextValue }
  };
}

export function createMobileInputBridgeSelectionPatch(
  previous: MobileInputBridgeState,
  nextValue: string,
  nextSelectionStart: number,
  nextSelectionEnd: number
): MobileInputBridgePatch | null {
  const selectionStart = Math.max(0, Math.min(nextSelectionStart, nextValue.length));
  const selectionEnd = Math.max(0, Math.min(nextSelectionEnd, nextValue.length));
  if (previous.value === nextValue && selectionStart !== selectionEnd) {
    return null;
  }

  return createMobileInputBridgePatch(previous, nextValue, selectionStart);
}
