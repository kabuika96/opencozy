import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

test("uploads multiple files, removes a selection, survives reload, delivers and downloads the original bytes", async ({ page }, testInfo) => {
  const directory = await mkdtemp(join(tmpdir(), "lh-browser-upload-"));
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./fixtures/uploadBackend.ts", import.meta.url)), join(directory, "test.sqlite")], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)), stdio: ["ignore", "pipe", "pipe"],
  });
  const sockets: WebSocket[] = [];
  let output = "";
  let stderr = "";
  child.stdout.on("data", data => { output += String(data); });
  child.stderr.on("data", data => { stderr += String(data); });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  try {
    await expect.poll(() => { if (child.exitCode !== null) throw new Error(stderr); return output.includes('"origin"'); }).toBe(true);
    const origin = JSON.parse(output.trim().split("\n").at(-1)!).origin;
    await fetch(`${origin}/api/threads`, { method: "POST", headers: { "content-type": "application/json", "x-liteharness-device-id": "pwa:upload-test" }, body: JSON.stringify({ title: "Upload test", workspacePath: directory }) });
    await page.addInitScript(() => localStorage.setItem("liteharness.deviceId.v1", "pwa:upload-test"));
    await page.route("**/api/**", async route => {
      const incoming = new URL(route.request().url());
      await route.fulfill({ response: await route.fetch({ url: `${origin}${incoming.pathname}${incoming.search}` }) });
    });
    await page.routeWebSocket("**/api/ws?**", socket => {
      const upstream = new WebSocket(`${origin.replace("http:", "ws:")}/api/ws${new URL(socket.url()).search}`);
      sockets.push(upstream);
      upstream.on("message", data => socket.send(String(data)));
      upstream.on("error", () => socket.close());
      socket.onClose(() => upstream.close());
    });
    await page.goto("/");
    await expect(page.getByLabel("Attach files", { exact: true })).toBeVisible();
    await page.getByLabel("Attach files").setInputFiles([
      { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello upload") },
      { name: "remove.txt", mimeType: "text/plain", buffer: Buffer.from("do not send") },
    ]);
    await expect(page.getByText("Uploading…")).toHaveCount(0);
    await page.getByRole("button", { name: "Remove remove.txt", exact: true }).click();
    await expect(page.getByRole("button", { name: "Run", exact: true })).toBeEnabled();
    await page.reload();
    await expect(page.getByRole("button", { name: "Remove notes.txt", exact: true })).toBeVisible();
    const attach = await page.getByLabel("Attach files", { exact: true }).boundingBox();
    const composer = await page.locator(".lh-mobile-composer").boundingBox();
    expect(attach!.y).toBeGreaterThanOrEqual(composer!.y);
    expect(attach!.y + attach!.height).toBeLessThanOrEqual(composer!.y + composer!.height + 1);
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByText("Received notes.txt: hello upload")).toBeVisible();
    await expect(page.getByRole("list", { name: "Message files" })).toHaveCount(1);
    await expect(page.getByRole("list", { name: "Message files" }).getByRole("button")).toHaveCount(1);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("list", { name: "Message files" }).getByRole("button").click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("notes.txt");
    expect(await readFile((await download.path())!, "utf8")).toBe("hello upload");
    await page.reload();
    await expect(page.getByRole("list", { name: "Message files" })).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    await page.screenshot({ path: `test-results/${testInfo.project.name}-uploads.png` });
  } finally {
    for (const socket of sockets) socket.close();
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
    await rm(directory, { recursive: true, force: true });
  }
});
