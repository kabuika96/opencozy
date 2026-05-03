import { describe, expect, it } from "vitest";
import { createTerminalOutputDrain } from "./terminalOutputDrain";

describe("terminal output drain", () => {
  it("marks first paint only after xterm finishes writing output", () => {
    const callbacks: Array<() => void> = [];
    const events: string[] = [];
    const drain = createTerminalOutputDrain({
      afterWrite: () => events.push("after-write"),
      onFirstPaint: () => events.push("first-paint"),
      requestFrame: (callback) => {
        callback();
        return 1;
      },
      write: (data, callback) => {
        events.push(`write:${data}`);
        callbacks.push(callback);
      },
      writeChunkSize: 32_000
    });

    drain.write("hello");

    expect(events).toEqual(["write:hello"]);

    callbacks.shift()?.();

    expect(events).toEqual(["write:hello", "after-write", "first-paint", "after-write"]);
  });

  it("calls first paint once across chunked output", () => {
    const callbacks: Array<() => void> = [];
    let firstPaintCount = 0;
    const drain = createTerminalOutputDrain({
      afterWrite: () => undefined,
      onFirstPaint: () => {
        firstPaintCount++;
      },
      requestFrame: (callback) => {
        callback();
        return 1;
      },
      write: (_data, callback) => {
        callbacks.push(callback);
      },
      writeChunkSize: 3
    });

    drain.write("abcdef");
    callbacks.shift()?.();
    callbacks.shift()?.();

    expect(firstPaintCount).toBe(1);
  });
});
