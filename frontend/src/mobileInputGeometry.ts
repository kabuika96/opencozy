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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
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
  const cursor = clamp(inputCursor, 0, Math.max(0, inputLength));
  const cursorLinear = clamp(cursorY, 0, rows - 1) * cols + clamp(cursorX, 0, cols - 1);
  const startLinear = clamp(cursorLinear - cursor, 0, maxLinearCell);
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
