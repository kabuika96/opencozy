import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { useTimelineScroll } from "./useTimelineScroll";

function Harness({ revision }: { revision: number }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const scroll = useTimelineScroll(ref, "thread:main", revision, true);
  return <><div ref={(node) => {
    if (!node) return;
    if (ref.current === node) return;
    Object.defineProperties(node, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1200 },
      scrollTop: { configurable: true, writable: true, value: 0 },
    });
    ref.current = node;
  }} />
    <button onClick={scroll.jumpToBottom}>Jump</button>
    {scroll.showJump ? <span>Jump visible</span> : null}
  </>;
}

describe("useTimelineScroll", () => {
  it("uses one real scroll element, preserves a paused reader, and jumps explicitly", async () => {
    const frame = vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
    const { container, rerender } = render(<Harness revision={0} />);
    const element = container.querySelector("div") as HTMLElement;
    await act(async () => { await Promise.resolve(); });
    expect(element.scrollTop).toBe(1200);

    element.scrollTop = 100;
    fireEvent.scroll(element);
    expect(screen.getByText("Jump visible")).toBeDefined();
    rerender(<Harness revision={1} />);
    expect(element.scrollTop).toBe(100);

    fireEvent.click(screen.getByRole("button", { name: "Jump" }));
    expect(element.scrollTop).toBe(1200);
    frame.mockRestore();
  });
});
