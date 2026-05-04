export type MobileInputGeometryInput = {
  cols: number;
  cursorX: number;
  cursorY: number;
  hostLeft: number;
  hostTop: number;
  inputCursor: number;
  inputLength: number;
  rows: number;
  screenHeight: number;
  screenLeft: number;
  screenTop: number;
  screenWidth: number;
};

export type MobileInputGeometry = {
  height: number;
  left: number;
  lineHeight: number;
  textIndent: number;
  top: number;
  width: number;
};

export type MobileInputSelectionGeometryInput = MobileInputGeometryInput & {
  selectionEnd: number;
  selectionStart: number;
};

export type MobileInputSelectionRect = {
  height: number;
  left: number;
  top: number;
  width: number;
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function getInputTextStartLinear({
  cols,
  cursorX,
  cursorY,
  inputCursor,
  inputLength,
  rows
}: Pick<MobileInputGeometryInput, "cols" | "cursorX" | "cursorY" | "inputCursor" | "inputLength" | "rows">): number {
  const maxLinearCell = rows * cols - 1;
  const cursor = clamp(inputCursor, 0, Math.max(0, inputLength));
  const cursorLinear = clamp(cursorY, 0, rows - 1) * cols + clamp(cursorX, 0, cols - 1);
  return clamp(cursorLinear - cursor, 0, maxLinearCell);
}

export function getMobileInputGeometry({
  cols,
  cursorX,
  cursorY,
  hostLeft,
  hostTop,
  inputCursor,
  inputLength,
  rows,
  screenHeight,
  screenLeft,
  screenTop,
  screenWidth
}: MobileInputGeometryInput): MobileInputGeometry | null {
  if (cols <= 0 || rows <= 0 || screenWidth <= 0 || screenHeight <= 0) {
    return null;
  }

  const cellWidth = screenWidth / cols;
  const cellHeight = screenHeight / rows;
  const maxLinearCell = rows * cols - 1;
  const cursorLinear = clamp(cursorY, 0, rows - 1) * cols + clamp(cursorX, 0, cols - 1);
  const startLinear = getInputTextStartLinear({ cols, cursorX, cursorY, inputCursor, inputLength, rows });
  const textEndLinear = startLinear + Math.max(1, inputLength) - 1;
  const endLinear = clamp(Math.max(textEndLinear, cursorLinear), startLinear, maxLinearCell);
  const startRow = Math.floor(startLinear / cols);
  const endRow = Math.floor(endLinear / cols);
  const startColumn = startLinear % cols;

  return {
    height: Math.max(cellHeight, (endRow - startRow + 1) * cellHeight),
    left: screenLeft - hostLeft,
    lineHeight: cellHeight,
    textIndent: startColumn * cellWidth,
    top: screenTop - hostTop + startRow * cellHeight,
    width: screenWidth
  };
}

export function getMobileInputSelectionRects({
  cols,
  cursorX,
  cursorY,
  hostLeft,
  hostTop,
  inputCursor,
  inputLength,
  rows,
  screenHeight,
  screenLeft,
  screenTop,
  screenWidth,
  selectionEnd,
  selectionStart
}: MobileInputSelectionGeometryInput): MobileInputSelectionRect[] {
  if (cols <= 0 || rows <= 0 || screenWidth <= 0 || screenHeight <= 0 || inputLength <= 0) {
    return [];
  }

  const normalizedStart = clamp(Math.min(selectionStart, selectionEnd), 0, inputLength);
  const normalizedEnd = clamp(Math.max(selectionStart, selectionEnd), 0, inputLength);
  if (normalizedStart === normalizedEnd) {
    return [];
  }

  const cellWidth = screenWidth / cols;
  const cellHeight = screenHeight / rows;
  const maxLinearExclusive = rows * cols;
  const inputStartLinear = getInputTextStartLinear({ cols, cursorX, cursorY, inputCursor, inputLength, rows });
  const selectionStartLinear = clamp(inputStartLinear + normalizedStart, 0, maxLinearExclusive);
  const selectionEndLinear = clamp(inputStartLinear + normalizedEnd, selectionStartLinear, maxLinearExclusive);
  if (selectionStartLinear === selectionEndLinear) {
    return [];
  }

  const firstRow = Math.floor(selectionStartLinear / cols);
  const lastRow = Math.floor((selectionEndLinear - 1) / cols);
  const rects: MobileInputSelectionRect[] = [];
  for (let row = firstRow; row <= lastRow; row++) {
    const rowStartLinear = row * cols;
    const rowEndLinear = rowStartLinear + cols;
    const highlightStartLinear = Math.max(selectionStartLinear, rowStartLinear);
    const highlightEndLinear = Math.min(selectionEndLinear, rowEndLinear);
    if (highlightEndLinear <= highlightStartLinear) {
      continue;
    }

    rects.push({
      height: cellHeight,
      left: screenLeft - hostLeft + (highlightStartLinear - rowStartLinear) * cellWidth,
      top: screenTop - hostTop + row * cellHeight,
      width: (highlightEndLinear - highlightStartLinear) * cellWidth
    });
  }

  return rects;
}
