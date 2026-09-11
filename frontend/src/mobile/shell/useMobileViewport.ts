import { useLayoutEffect, useState, type RefObject } from "react";

const keyboardInputTypes = new Set(["text", "search", "email", "url", "tel", "password", "number"]);

function isTextEntry(element: Element | null): element is HTMLElement {
  if (element instanceof HTMLInputElement) return keyboardInputTypes.has(element.type) && !element.disabled && !element.readOnly;
  if (element instanceof HTMLTextAreaElement) return !element.disabled && !element.readOnly;
  return element instanceof HTMLElement && element.matches("[contenteditable='true'], [contenteditable='plaintext-only']");
}

export function dismissKeyboard(): void {
  const element = document.activeElement;
  if (isTextEntry(element)) {
    element.blur();
  }
}

/** One geometry source for the shell, keyboard and composer-adjacent controls. */
export function useMobileViewport(footerRef: RefObject<HTMLElement | null>, surfaceKey: string) {
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const viewport = window.visualViewport;
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        // Pinch magnification must not resize/reflow the app underneath the gesture.
        const scaled = viewport && Math.abs(viewport.scale - 1) > 0.05;
        const height = !scaled && viewport ? viewport.height : window.innerHeight;
        const top = !scaled && viewport ? viewport.offsetTop : 0;
        const editing = isTextEntry(document.activeElement);
        const keyboard = editing && window.innerHeight - height > 100;
        root.style.setProperty("--lh-viewport-height", `${height}px`);
        root.style.setProperty("--lh-viewport-top", `${top}px`);
        root.style.setProperty("--lh-composer-height", `${footerRef.current?.getBoundingClientRect().height ?? 0}px`);
        root.classList.toggle("lh-keyboard-visible", keyboard);
        setKeyboardVisible(editing);
      });
    };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (footerRef.current) observer?.observe(footerRef.current);
    viewport?.addEventListener("resize", measure);
    viewport?.addEventListener("scroll", measure);
    window.addEventListener("resize", measure);
    document.addEventListener("focusin", measure);
    document.addEventListener("focusout", measure);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      viewport?.removeEventListener("resize", measure);
      viewport?.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      document.removeEventListener("focusin", measure);
      document.removeEventListener("focusout", measure);
      root.classList.remove("lh-keyboard-visible");
    };
  }, [footerRef, surfaceKey]);
  return { keyboardVisible, dismissKeyboard };
}
