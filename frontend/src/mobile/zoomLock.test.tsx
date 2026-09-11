import { cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { installAppZoomLock } from "./zoomLock";

describe("app zoom lock", () => {
  afterEach(() => {
    cleanup();
    document.head.innerHTML = "";
  });

  it("ships a viewport that does not allow page scaling", () => {
    const html = readFileSync("index.html", "utf8");

    expect(html).toContain("maximum-scale=1");
    expect(html).toContain("minimum-scale=1");
    expect(html).toContain("user-scalable=no");
  });

  it("paints the startup document black before app css loads", () => {
    const html = readFileSync("index.html", "utf8");

    expect(html).toMatch(/<style>[\s\S]*html,[\s\S]*body,[\s\S]*#root[\s\S]*background:\s*#050505/);
    expect(html.indexOf("<style>")).toBeGreaterThan(-1);
    expect(html.indexOf("<style>")).toBeLessThan(html.indexOf('<script type="module"'));
  });

  it("keeps editable text controls at the iOS focus-safe size", () => {
    const style = document.createElement("style");
    style.textContent = readFileSync("src/mobile/styles/mobile.css", "utf8");
    document.head.append(style);

    render(
      <div className="lh-app">
        <form className="lh-mobile-thread-rename-form">
          <input aria-label="Rename" />
        </form>
        <form className="lh-mobile-workspace-form">
          <textarea aria-label="Workspace" />
        </form>
        <form className="lh-mobile-input-form">
          <label className="lh-mobile-input-other">
            <input aria-label="Other" />
          </label>
          <fieldset className="lh-mobile-input-question">
            <textarea aria-label="Question" />
          </fieldset>
        </form>
        <label className="lh-mobile-preview-field">
          <input aria-label="Preview" />
        </label>
      </div>,
    );

    expect(getComputedStyle(screen.getByLabelText("Rename")).fontSize).toBe("16px");
    expect(getComputedStyle(screen.getByLabelText("Workspace")).fontSize).toBe("16px");
    expect(getComputedStyle(screen.getByLabelText("Other")).fontSize).toBe("16px");
    expect(getComputedStyle(screen.getByLabelText("Question")).fontSize).toBe("16px");
    expect(getComputedStyle(screen.getByLabelText("Preview")).fontSize).toBe("16px");
  });

  it("blocks browser zoom gestures and shortcuts at runtime", () => {
    const cleanupZoomLock = installAppZoomLock();

    const pinch = new Event("gesturestart", { cancelable: true });
    window.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(true);

    const ctrlWheel = new WheelEvent("wheel", { cancelable: true, ctrlKey: true });
    window.dispatchEvent(ctrlWheel);
    expect(ctrlWheel.defaultPrevented).toBe(true);

    const regularWheel = new WheelEvent("wheel", { cancelable: true });
    window.dispatchEvent(regularWheel);
    expect(regularWheel.defaultPrevented).toBe(false);

    const zoomKey = new KeyboardEvent("keydown", { cancelable: true, metaKey: true, key: "=" });
    window.dispatchEvent(zoomKey);
    expect(zoomKey.defaultPrevented).toBe(true);

    const regularKey = new KeyboardEvent("keydown", { cancelable: true, metaKey: true, key: "k" });
    window.dispatchEvent(regularKey);
    expect(regularKey.defaultPrevented).toBe(false);

    cleanupZoomLock();
  });

  it("does not swallow quick consecutive button taps", () => {
    const dispose = installAppZoomLock();
    const first = new Event("touchend", { cancelable: true, bubbles: true });
    const second = new Event("touchend", { cancelable: true, bubbles: true });
    window.dispatchEvent(first);
    window.dispatchEvent(second);
    expect(second.defaultPrevented).toBe(false);
    dispose();
  });
});
