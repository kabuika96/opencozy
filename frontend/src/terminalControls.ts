export type TerminalArrowPadState = {
  keyboardFocused: boolean;
  terminalFallbackControlsVisible: boolean;
};

export function shouldShowArrowPad({
  keyboardFocused,
  terminalFallbackControlsVisible
}: TerminalArrowPadState): boolean {
  return !keyboardFocused || terminalFallbackControlsVisible;
}
