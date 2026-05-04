type KeyboardEventTarget = Pick<EventTarget, "addEventListener" | "removeEventListener">;

type KeyboardViewport = KeyboardEventTarget & {
  height: number;
  offsetTop: number;
};

type KeyboardWindow = KeyboardEventTarget & {
  document: Document;
  innerHeight: number;
  innerWidth: number;
  matchMedia?: (query: string) => { matches: boolean };
  navigator: Navigator;
  setTimeout: typeof window.setTimeout;
  visualViewport?: KeyboardViewport | null;
};

type BindKeyboardReserveOptions = {
  onKeyboardHidden?: () => void;
};

const MIN_KEYBOARD_PX = 260;
const MAX_KEYBOARD_PHONE_PX = 430;
const MAX_KEYBOARD_TABLET_PX = 380;
const KEYBOARD_THRESHOLD_PX = 80;

type KeyboardReserveState = {
  activeCount: number;
};

const keyboardReserveStates = new WeakMap<object, KeyboardReserveState>();

function keyboardReserveState(win: KeyboardWindow): KeyboardReserveState {
  let state = keyboardReserveStates.get(win.document);
  if (!state) {
    state = { activeCount: 0 };
    keyboardReserveStates.set(win.document, state);
  }

  return state;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function px(value: number): string {
  return `${Math.max(0, Math.round(value))}px`;
}

function layoutHeight(win: KeyboardWindow): number {
  return win.innerHeight || win.document.documentElement.clientHeight;
}

function hasTouchKeyboard(win: KeyboardWindow): boolean {
  return Boolean(
    win.matchMedia?.("(pointer: coarse)").matches ||
      win.navigator.maxTouchPoints > 0 ||
      "ontouchstart" in win
  );
}

function fallbackKeyboardHeight(win: KeyboardWindow, baselineHeight: number): number {
  const isTabletWidth = win.innerWidth >= 700;
  const ratio = isTabletWidth ? 0.34 : 0.44;
  const max = isTabletWidth ? MAX_KEYBOARD_TABLET_PX : MAX_KEYBOARD_PHONE_PX;

  return clamp(baselineHeight * ratio, MIN_KEYBOARD_PX, max);
}

export function bindKeyboardReserve(
  input: KeyboardEventTarget,
  win: KeyboardWindow = window,
  options: BindKeyboardReserveOptions = {}
): () => void {
  const rootStyle = win.document.documentElement.style;
  const state = keyboardReserveState(win);
  let active = false;
  let baselineHeight = layoutHeight(win);
  let hadViewportKeyboardSignal = false;
  let keyboardVisible = false;

  const setReserve = (value: number) => {
    rootStyle.setProperty("--oc-keyboard-reserve", px(value));
  };

  const setKeyboardVisible = (visible: boolean) => {
    if (keyboardVisible === visible) {
      return;
    }

    keyboardVisible = visible;
    if (!visible) {
      options.onKeyboardHidden?.();
    }
  };

  const update = () => {
    const currentHeight = layoutHeight(win);
    if (!active) {
      baselineHeight = Math.max(baselineHeight, currentHeight);
      if (state.activeCount === 0) {
        setReserve(0);
      }
      setKeyboardVisible(false);
      return;
    }

    const layoutAlreadyResized = baselineHeight - currentHeight > KEYBOARD_THRESHOLD_PX;
    if (layoutAlreadyResized) {
      hadViewportKeyboardSignal = true;
      setReserve(0);
      setKeyboardVisible(true);
      return;
    }

    const visualHeight = win.visualViewport?.height ?? currentHeight;
    const measuredReserve = baselineHeight - visualHeight;
    if (measuredReserve > KEYBOARD_THRESHOLD_PX) {
      hadViewportKeyboardSignal = true;
      setReserve(Math.max(measuredReserve, fallbackKeyboardHeight(win, baselineHeight)));
      setKeyboardVisible(true);
      return;
    }

    if (hadViewportKeyboardSignal) {
      setReserve(0);
      setKeyboardVisible(false);
      return;
    }

    const fallbackReserve = hasTouchKeyboard(win) ? fallbackKeyboardHeight(win, baselineHeight) : 0;
    setReserve(fallbackReserve);
    setKeyboardVisible(fallbackReserve > 0);
  };

  const updateSoon = () => {
    update();
    win.setTimeout(update, 80);
    win.setTimeout(update, 280);
  };

  const activate = () => {
    if (active) {
      return;
    }

    active = true;
    state.activeCount += 1;
  };

  const deactivate = () => {
    if (!active) {
      return;
    }

    active = false;
    state.activeCount = Math.max(0, state.activeCount - 1);
  };

  const handleFocus = () => {
    activate();
    hadViewportKeyboardSignal = false;
    baselineHeight = Math.max(baselineHeight, layoutHeight(win));
    updateSoon();
  };

  const handleBlur = () => {
    deactivate();
    hadViewportKeyboardSignal = false;
    updateSoon();
  };

  const handleOrientationChange = () => {
    baselineHeight = layoutHeight(win);
    updateSoon();
  };

  input.addEventListener("focus", handleFocus);
  input.addEventListener("blur", handleBlur);
  win.addEventListener("resize", updateSoon);
  win.addEventListener("orientationchange", handleOrientationChange);
  win.visualViewport?.addEventListener("resize", updateSoon);
  win.visualViewport?.addEventListener("scroll", updateSoon);

  update();

  return () => {
    input.removeEventListener("focus", handleFocus);
    input.removeEventListener("blur", handleBlur);
    win.removeEventListener("resize", updateSoon);
    win.removeEventListener("orientationchange", handleOrientationChange);
    win.visualViewport?.removeEventListener("resize", updateSoon);
    win.visualViewport?.removeEventListener("scroll", updateSoon);
    deactivate();
    if (state.activeCount === 0) {
      setReserve(0);
    }
    setKeyboardVisible(false);
  };
}
