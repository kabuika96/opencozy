import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("backend dev script", () => {
  it("keeps the default backend process stable instead of watch-restarting it", async () => {
    const packageJson = JSON.parse(await readFile("package.json", "utf8")) as {
      scripts?: Record<string, string>;
    };

    expect(packageJson.scripts?.dev).toBe("tsx src/server.ts");
    expect(packageJson.scripts?.["dev:watch"]).toContain("tsx watch");
    expect(packageJson.scripts?.["dev:watch"]).toContain("--exclude data");
    expect(packageJson.scripts?.["dev:watch"]).toContain("--exclude dist");
  });
});
