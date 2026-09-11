import { expect, test } from "@playwright/test";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

for (const reloadDuringRestart of [false, true]) {
test(`${reloadDuringRestart ? "a reloading" : "an open"} tab recovers from HTTP 500 during a backend restart`, async ({ page }) => {
  const directory = await mkdtemp(join(tmpdir(), "lh-browser-restart-"));
  const database = join(directory, "test.sqlite");
  const children: ChildProcess[] = [];
  const sockets: WebSocket[] = [];
  const errors: string[] = [];
  const requests: string[] = [];
  page.on("pageerror", error => errors.push(error.message));

  async function start(port = 0) {
    const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./fixtures/restartBackend.ts", import.meta.url)), database, String(port)], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)), stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(child);
    let stdout = "";
    let stderr = "";
    child.stdout!.on("data", data => { stdout += String(data); });
    child.stderr!.on("data", data => { stderr += String(data); });
    await expect.poll(() => {
      if (child.exitCode !== null) throw new Error(`Test backend exited: ${stderr}`);
      return stdout.includes('"origin"');
    }).toBe(true);
    const origin = JSON.parse(stdout.trim().split("\n").at(-1)!).origin as string;
    return { child, origin };
  }

  async function stop(child: ChildProcess) {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    await exited;
  }

  try {
    const first = await start();
    const headers = { "x-liteharness-device-id": "pwa:restart-test", "content-type": "application/json" };
    const created = await fetch(`${first.origin}/api/threads`, { method: "POST", headers, body: JSON.stringify({ title: "Restart test", workspacePath: directory }) });
    expect(created.status).toBe(201);
    const thread = await created.json() as { id: string };
    await fetch(`${first.origin}/api/threads/${thread.id}/runs`, { method: "POST", headers, body: JSON.stringify({ prompt: "Hold until restart" }) });

    await page.addInitScript(() => localStorage.setItem("liteharness.deviceId.v1", "pwa:restart-test"));
    await page.route("**/api/**", async route => {
      const incoming = new URL(route.request().url());
      requests.push(`${route.request().method()} ${incoming.pathname}`);
      try {
        const response = await route.fetch({ url: `${first.origin}${incoming.pathname}${incoming.search}`, timeout: 1_000 });
        await route.fulfill({ response });
      } catch {
        // Vite returns an empty HTTP 500 while its backend is unavailable.
        await route.fulfill({ status: 500, body: "" });
      }
    });
    await page.routeWebSocket("**/api/ws?**", socket => {
      const upstream = new WebSocket(`${first.origin.replace("http:", "ws:")}/api/ws${new URL(socket.url()).search}`);
      sockets.push(upstream);
      upstream.on("message", data => socket.send(String(data)));
      upstream.on("close", () => socket.close());
      upstream.on("error", () => socket.close());
      socket.onClose(() => upstream.close());
    });

    await page.goto("/");
    await expect(page.getByText("History survives the restart.")).toBeVisible();
    await expect(page.getByText("Working", { exact: true })).toBeVisible();
    await page.getByLabel("Prompt", { exact: true }).fill("Continue here");
    await expect.poll(() => page.evaluate(() => localStorage.getItem("liteharness.promptDrafts.v1"))).toContain("Continue here");
    await stop(first.child);
    if (reloadDuringRestart) await page.reload();
    await expect(page.locator(".lh-mobile-error")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator(".lh-mobile-error")).toHaveText("Request failed: 500");
    await start(Number(new URL(first.origin).port));

    await expect(page.getByRole("button", { name: "Run", exact: true })).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Working", { exact: true })).toHaveCount(0);
    await expect(page.locator(".lh-mobile-error")).toHaveCount(0);
    await expect(page.getByRole("tab", { name: "Active thread Restart test" })).toBeVisible();
    await expect(page.getByText("History survives the restart.")).toBeVisible();
    await expect(page.getByLabel("Prompt", { exact: true })).toHaveValue("Continue here");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByText("Continued in the same thread.")).toBeVisible();
    expect(requests.filter(request => request === `POST /api/threads/${thread.id}/runs`)).toHaveLength(1);
    expect(requests).not.toContain("POST /api/threads");
    expect(requests).not.toContain(`POST /api/threads/${thread.id}/runs/input`);
    expect(errors).toEqual([]);
  } finally {
    await page.close();
    for (const socket of sockets) socket.terminate();
    for (const child of children) await stop(child);
    await rm(directory, { recursive: true, force: true });
  }
});
}
