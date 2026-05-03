export type TerminalVisualCursorSnapshot = {
  baseY: number;
  cols: number;
  cursorX: number;
  cursorY: number;
  hostLeft: number;
  hostTop: number;
  rows: number;
  screenHeight: number;
  screenLeft: number;
  screenTop: number;
  screenWidth: number;
  viewportY: number;
};

export type TerminalVisualCursorStyle =
  | { display: "none" }
  | {
      display: "block";
      height: string;
      transform: string;
      width: string;
    };

export function getTerminalVisualCursorStyle(snapshot: TerminalVisualCursorSnapshot): TerminalVisualCursorStyle {
  if (snapshot.cols <= 0 || snapshot.rows <= 0 || snapshot.screenWidth <= 0 || snapshot.screenHeight <= 0) {
    return { display: "none" };
  }

  const viewportCursorRow = snapshot.baseY + snapshot.cursorY - snapshot.viewportY;
  if (viewportCursorRow < 0 || viewportCursorRow >= snapshot.rows) {
    return { display: "none" };
  }

  const cellWidth = snapshot.screenWidth / snapshot.cols;
  const cellHeight = snapshot.screenHeight / snapshot.rows;
  const cursorColumn = Math.max(0, Math.min(snapshot.cursorX, snapshot.cols - 1));
  const left = snapshot.screenLeft - snapshot.hostLeft + cursorColumn * cellWidth;
  const top = snapshot.screenTop - snapshot.hostTop + viewportCursorRow * cellHeight;

  return {
    display: "block",
    height: `${cellHeight}px`,
    transform: `translate(${left}px, ${top}px)`,
    width: `${Math.max(2, Math.round(cellWidth * 0.14))}px`
  };
}
