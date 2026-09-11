const lockedViewportContent = [
  "width=device-width",
  "initial-scale=1",
  "maximum-scale=1",
  "minimum-scale=1",
  "user-scalable=no",
  "viewport-fit=cover",
].join(", ");

const zoomKeys = new Set(["+", "=", "-", "_", "0"]);
const zoomCodes = new Set(["Equal", "Minus", "NumpadAdd", "NumpadSubtract", "Digit0", "Numpad0"]);

export function installAppZoomLock(targetWindow: Window = window, targetDocument: Document = document): () => void {
  lockViewportScale(targetDocument);

  const listenerOptions: AddEventListenerOptions = { passive: false };
  const cleanups: Array<() => void> = [];

  const preventDefault = (event: Event) => {
    if (event.cancelable) {
      event.preventDefault();
    }
  };

  for (const eventName of ["gesturestart", "gesturechange", "gestureend"]) {
    targetWindow.addEventListener(eventName, preventDefault, listenerOptions);
    cleanups.push(() => targetWindow.removeEventListener(eventName, preventDefault, listenerOptions));
  }

  const preventModifiedWheelZoom = (event: WheelEvent) => {
    if (event.ctrlKey || event.metaKey) {
      preventDefault(event);
    }
  };
  targetWindow.addEventListener("wheel", preventModifiedWheelZoom, listenerOptions);
  cleanups.push(() => targetWindow.removeEventListener("wheel", preventModifiedWheelZoom, listenerOptions));

  const preventKeyboardZoom = (event: KeyboardEvent) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    if (zoomKeys.has(event.key) || zoomCodes.has(event.code)) {
      preventDefault(event);
    }
  };
  targetWindow.addEventListener("keydown", preventKeyboardZoom);
  cleanups.push(() => targetWindow.removeEventListener("keydown", preventKeyboardZoom));

  const preventMultiTouchZoom = (event: TouchEvent) => {
    if (event.touches.length > 1) {
      preventDefault(event);
    }
  };
  targetWindow.addEventListener("touchmove", preventMultiTouchZoom, listenerOptions);
  cleanups.push(() => targetWindow.removeEventListener("touchmove", preventMultiTouchZoom, listenerOptions));


  return () => {
    for (const cleanup of cleanups) {
      cleanup();
    }
  };
}

function lockViewportScale(targetDocument: Document): void {
  let viewport = targetDocument.querySelector<HTMLMetaElement>("meta[name='viewport']");

  if (!viewport) {
    viewport = targetDocument.createElement("meta");
    viewport.name = "viewport";
    targetDocument.head.append(viewport);
  }

  viewport.content = lockedViewportContent;
}
