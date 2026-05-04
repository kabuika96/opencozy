import { describe, expect, it } from "vitest";
import {
  defaultPreviewUrl,
  normalizePreviewUrl,
  readSessionPreviewUrl,
  removeSessionPreviewUrl,
  sessionPreviewUrlKey,
  writeSessionPreviewUrl
} from "./sessionPreviewUrls";

class MemoryStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

describe("session preview URLs", () => {
  it("defaults each session to an empty preview URL", () => {
    const storage = new MemoryStorage();

    expect(defaultPreviewUrl()).toBe("");
    expect(readSessionPreviewUrl(storage, "session-1")).toBe("");
  });

  it("stores preview URLs under the session id", () => {
    const storage = new MemoryStorage();

    writeSessionPreviewUrl(storage, "session-1", "http://opencozy.local:3000/");

    expect(storage.values.get(sessionPreviewUrlKey("session-1"))).toBe("http://opencozy.local:3000/");
    expect(readSessionPreviewUrl(storage, "session-1")).toBe("http://opencozy.local:3000/");
    expect(readSessionPreviewUrl(storage, "session-2")).toBe(defaultPreviewUrl());
  });

  it("removes only the closed session preview URL", () => {
    const storage = new MemoryStorage();
    writeSessionPreviewUrl(storage, "session-1", "http://opencozy.local:3000/");
    writeSessionPreviewUrl(storage, "session-2", "http://opencozy.local:4000/");

    removeSessionPreviewUrl(storage, "session-1");

    expect(readSessionPreviewUrl(storage, "session-1")).toBe(defaultPreviewUrl());
    expect(readSessionPreviewUrl(storage, "session-2")).toBe("http://opencozy.local:4000/");
  });

  it("normalizes bare hosts to HTTP URLs", () => {
    expect(normalizePreviewUrl("localhost:5173")).toBe("http://localhost:5173/");
  });
});
