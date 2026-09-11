import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { useMobileViewport } from "./useMobileViewport";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("follows visible keyboard geometry and provides dismissal without canceling work", async () => {
  const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
  vi.stubGlobal("visualViewport", viewport);
  function Screen() {
    const footer = useRef<HTMLDivElement>(null);
    const { keyboardVisible, dismissKeyboard } = useMobileViewport(footer, "chat");
    return <div ref={footer}><textarea aria-label="Prompt" /><button onClick={dismissKeyboard}>{keyboardVisible ? "Hide keyboard" : "Hidden"}</button></div>;
  }
  render(<Screen />);
  await waitFor(() => expect(document.documentElement.style.getPropertyValue("--lh-viewport-height")).toBe("800px"));
  act(() => {
    screen.getByLabelText("Prompt").focus();
    viewport.height = 420;
    viewport.offsetTop = 12;
    viewport.dispatchEvent(new Event("resize"));
  });
  await waitFor(() => expect(document.documentElement.style.getPropertyValue("--lh-viewport-height")).toBe("420px"));
  expect(document.documentElement.style.getPropertyValue("--lh-viewport-top")).toBe("12px");
  act(() => screen.getByText("Hide keyboard").click());
  expect(document.activeElement).not.toBe(screen.getByLabelText("Prompt"));
});

it("does not toggle keyboard chrome when focus returns to a file picker", async () => {
  const viewport = Object.assign(new EventTarget(), { height: 800, offsetTop: 0, scale: 1 });
  vi.stubGlobal("visualViewport", viewport);
  function Screen() {
    const footer = useRef<HTMLDivElement>(null);
    const { keyboardVisible } = useMobileViewport(footer, "chat");
    return <div ref={footer}><input type="file" aria-label="Attach files" /><button>Outside</button><output>{keyboardVisible ? "Keyboard shown" : "Keyboard hidden"}</output></div>;
  }
  render(<Screen />);
  await waitFor(() => expect(document.documentElement.style.getPropertyValue("--lh-viewport-height")).toBe("800px"));
  for (let attempt = 0; attempt < 3; attempt++) {
    act(() => screen.getByLabelText("Attach files").focus());
    // Let the focus-driven viewport measurement finish, as on native picker dismissal.
    await act(async () => { await new Promise(resolve => requestAnimationFrame(() => resolve(undefined))); });
    expect(screen.getByText("Keyboard hidden")).toBeTruthy();
    expect(document.documentElement.classList.contains("lh-keyboard-visible")).toBe(false);
    act(() => screen.getByText("Outside").focus());
  }
});
