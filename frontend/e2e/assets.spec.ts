import { touchGesture } from "./fixtures/touchGestures";
import { expect, test } from "@playwright/test";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("shares files, previews formats, and retrieves them in a new chat after closing their source", async ({ page }, testInfo) => {
  test.setTimeout(75_000);
  const directory = await mkdtemp(join(tmpdir(), "lh-browser-assets-"));
  const child = spawn(process.execPath, ["--import", "tsx", fileURLToPath(new URL("./fixtures/assetBackend.ts", import.meta.url)), join(directory, "test.sqlite")], {
    cwd: fileURLToPath(new URL("../../", import.meta.url)), stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let stderr = "";
  child.stdout.on("data", data => { output += String(data); });
  child.stderr.on("data", data => { stderr += String(data); });
  const errors: string[] = [];
  let compatibilityWorkers = 0;
  const leakedRequests: string[] = [];
  await page.route(/example\.com|\/leaked/, async route => {
    leakedRequests.push(route.request().url());
    await route.fulfill({ status: 200, body: "blocked by test" });
  });
  // Reproduce older Safari engines in both the page and PDF worker.
  // The browser's newer Map APIs must not mask PDF compatibility regressions.
  await page.addInitScript(() => {
    for (const prototype of [Map.prototype, WeakMap.prototype]) {
      Reflect.deleteProperty(prototype, 'getOrInsertComputed');
      Reflect.deleteProperty(prototype, 'getOrInsert');
    }
  });
  // Match worker code, excluding Vite’s ?url module evaluated in the page.
  await page.route(/pdf\.worker[^?]*\.mjs$/, async route => {
    compatibilityWorkers++;
    const response = await route.fetch();
    const missingApis = "for (const p of [Map.prototype, WeakMap.prototype]) { Reflect.deleteProperty(p, 'getOrInsertComputed'); Reflect.deleteProperty(p, 'getOrInsert'); }\n";
    await route.fulfill({ response, body: missingApis + await response.text() });
  });
  await page.addInitScript(() => {
    (window as any).assetShares = [];
    (window as any).assetShareMode = 'ok';
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => (window as any).assetShareMode !== 'unsupported' });
    Object.defineProperty(navigator, 'share', { configurable: true, value: async (data: ShareData) => {
      const active = navigator.userActivation.isActive;
      const mode = (window as any).assetShareMode;
      const files = await Promise.all(data.files!.map(async file => ({ name: file.name, type: file.type, size: file.size,
        sha256: Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))).map(byte => byte.toString(16).padStart(2, '0')).join(''),
      })));
      (window as any).assetShares.push({ active, files, keys: Object.keys(data) });
      if (mode === 'cancel') throw new DOMException('Canceled', 'AbortError');
      if (mode === 'error') throw new DOMException('Unavailable', 'NotAllowedError');
    } });
  });
  page.on("pageerror", error => errors.push(error.message));
  try {
    await expect.poll(() => { if (child.exitCode !== null) throw new Error(stderr); return output.includes('"origin"'); }).toBe(true);
    const origin = JSON.parse(output.trim().split("\n").at(-1)!).origin;
    const created = await fetch(`${origin}/api/threads`, { method: "POST", headers: { "content-type": "application/json", "x-liteharness-device-id": "pwa:assets-test" }, body: JSON.stringify({ title: "Assets test", workspacePath: directory }) });
    const sourceThread = await created.json() as { id: string };
    await page.addInitScript(() => { if (window === window.top) localStorage.setItem("liteharness.deviceId.v1", "pwa:assets-test"); });
    await page.goto(origin);
    await page.getByLabel("Prompt", { exact: true }).fill("Share example files");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByText("Files ready.")).toBeVisible();
    await expect(page.getByRole("button", { name: 'Open 6 files', exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Open file:/ })).toHaveCount(0);
    const stack = page.locator('.lh-file-stack');
    expect((await stack.boundingBox())!.height).toBeLessThanOrEqual(120);
    await page.setViewportSize({ width: 320, height: 690 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/${testInfo.project.name}-file-stack.png` });
    await page.getByRole('button', { name: 'Share all 6 files', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Share 6 files', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Share 6 files', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Share files', exact: true })).toHaveCount(0);
    const savedAssets = await (await fetch(`${origin}/api/assets`, { headers: { 'x-liteharness-device-id': 'pwa:assets-test' } })).json();
    const shares = await page.evaluate(() => (window as any).assetShares);
    expect(shares[0].active).toBe(true);
    expect(shares[0].files).toHaveLength(6);
    for (const asset of savedAssets.assets) expect(shares[0].files).toContainEqual({ name: asset.name, type: asset.mediaType, size: asset.size, sha256: asset.sha256 });
    expect(shares[0].keys).toEqual(['files']);
    await page.reload();
    await page.getByRole('button', { name: 'Open 6 files', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'File list', exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /^Open file:/ })).toHaveCount(6);
    expect(await page.getByRole('dialog', { name: 'File list', exact: true }).evaluate(element => element.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `test-results/${testInfo.project.name}-file-list.png` });
    // Individual sharing keeps the list open, cancellation is silent, and errors are retryable.
    await page.getByRole('button', { name: 'Share file: Coverage notes', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Share file', exact: true })).toBeEnabled();
    await page.evaluate(() => { (window as any).assetShareMode = 'cancel'; });
    await page.getByRole('button', { name: 'Share file', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Share files', exact: true })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: 'File list', exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect((await page.evaluate(() => (window as any).assetShares))[0].files).toHaveLength(1);
    await page.getByRole('dialog', { name: 'File list', exact: true }).getByRole('button', { name: 'Share all 6 files', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Share 6 files', exact: true })).toBeEnabled();
    await page.evaluate(() => { (window as any).assetShareMode = 'error'; });
    await page.getByRole('button', { name: 'Share 6 files', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Sharing could not open or finish');
    await page.evaluate(() => { (window as any).assetShareMode = 'ok'; });
    await page.getByRole('button', { name: 'Share 6 files', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Share files', exact: true })).toHaveCount(0);
    await page.evaluate(() => { (window as any).assetShareMode = 'unsupported'; });
    await page.getByRole('button', { name: 'Share file: Coverage notes', exact: true }).click();
    await expect(page.getByRole('status')).toContainText('Native sharing isn’t available');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'File list', exact: true })).toBeVisible();
    await page.evaluate(() => { (window as any).assetShareMode = 'ok'; });
    // A failed member never produces a partial native share; retry prepares the entire selection.
    const failingUrl = `**/api/assets/${savedAssets.assets[1].id}/content?*`;
    await page.route(failingUrl, route => route.fulfill({ status: 503, body: 'Unavailable' }));
    const sharesBeforeFailure = await page.evaluate(() => (window as any).assetShares.length);
    await page.getByRole('dialog', { name: 'File list', exact: true }).getByRole('button', { name: 'Share all 6 files', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Could not prepare');
    expect(await page.evaluate(() => (window as any).assetShares.length)).toBe(sharesBeforeFailure);
    await page.unroute(failingUrl);
    await page.getByRole('button', { name: 'Retry', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Share 6 files', exact: true })).toBeEnabled();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'File list', exact: true })).toBeVisible();
    const card = page.getByRole("button", { name: "Open file: Coverage notes" });
    await card.scrollIntoViewIfNeeded();
    const before = await page.locator(".lh-mobile-chat-content").evaluate(element => element.scrollTop);
    await card.click();
    await expect(page.getByRole("dialog", { name: /^File preview:/ })).toBeVisible();
    await expect(page.locator(".lh-asset-text")).toContainText("bluebird");
    await page.getByRole('dialog', { name: /^File preview:/ }).getByRole('button', { name: 'Share file', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Share files', exact: true }).getByRole('button', { name: 'Share file', exact: true })).toBeEnabled();
    await page.getByRole('dialog', { name: 'Share files', exact: true }).getByRole('button', { name: 'Share file', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Share files', exact: true })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: /^File preview:/ })).toBeVisible();
    await page.getByRole('button', { name: 'Larger text', exact: true }).click();
    await expect(page.locator('.lh-asset-text')).toHaveCSS('font-size', '18px');
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: /^File preview:/ })).toHaveCount(0);
    expect(await page.locator(".lh-mobile-chat-content").evaluate(element => element.scrollTop)).toBe(before);
    await page.getByRole("button", { name: "Open file: HTML report" }).click();
    await expect(page.frameLocator(".lh-asset-html").getByRole("heading", { name: "Rendered report" })).toBeVisible();
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await expect(page.getByLabel('Zoom level', { exact: true })).toHaveText('125%');
    await expect(page.frameLocator('.lh-asset-html').getByRole('heading', { name: 'Rendered report' })).toBeVisible();
    expect(await page.evaluate(() => (window as any).assetScriptExecuted)).toBeUndefined();
    expect(await page.locator(".lh-asset-html").getAttribute("sandbox")).toBe("");
    await expect(page.frameLocator(".lh-asset-html").locator("a")).not.toHaveAttribute("href");
    await page.getByRole("button", { name: "Close file preview" }).click();
    await page.getByRole("button", { name: "Open file: PDF report" }).click();
    await expect(page.getByRole("navigation", { name: "PDF pages" })).toContainText("1 / 2");
    await expect.poll(() => page.locator(".lh-pdf-page canvas").evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeGreaterThan(200);
    await expect.poll(() => page.locator(".lh-pdf-page canvas").evaluate((canvas: HTMLCanvasElement) => {
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let index = 0; index < pixels.length; index += 4) {
        if (pixels[index + 3] > 0 && pixels[index] < 100 && pixels[index + 1] < 100 && pixels[index + 2] < 100) return true;
      }
      return false;
    })).toBe(true);
    // Playwright exposes native multi-touch injection through Chromium's CDP.
    if (testInfo.project.use.browserName === 'chromium') {
      const pdfSurface = page.getByLabel("PDF gestures", { exact: true });
      await touchGesture(page, pdfSurface, 'pinch');
      await expect(page.getByLabel("Zoom level", { exact: true })).toHaveText('260%');
      await touchGesture(page, pdfSurface, 'pinch');
      await expect(page.getByLabel("Zoom level", { exact: true })).toHaveText('400%');
      await touchGesture(page, pdfSurface, 'left');
      await expect(page.getByRole("navigation", { name: "PDF pages" })).toContainText("1 / 2");
      await page.getByRole("button", { name: "Fit to screen", exact: true }).click();
      await touchGesture(page, pdfSurface, 'left');
      await expect(page.getByRole("navigation", { name: "PDF pages" })).toContainText("2 / 2");
      await touchGesture(page, pdfSurface, 'right');
      await expect(page.getByRole("navigation", { name: "PDF pages" })).toContainText("1 / 2");
      await touchGesture(page, pdfSurface, 'left', true);
      await expect(page.getByRole("navigation", { name: "PDF pages" })).toContainText("1 / 2");
      await page.setViewportSize({ width: 320, height: 690 });
      await expect(page.getByLabel('Zoom level', { exact: true })).toHaveText('100%');
      expect(await page.getByRole('dialog', { name: /^File preview:/ }).evaluate(element => element.scrollWidth <= innerWidth)).toBe(true);
      await touchGesture(page, page.getByLabel('PDF gestures', { exact: true }), 'left');
      await expect(page.getByRole("navigation", { name: "PDF pages" })).toContainText("2 / 2");
    } else {
      await page.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(page.getByRole('navigation', { name: 'PDF pages' })).toContainText('2 / 2');
    }
    await page.screenshot({ path: `test-results/${testInfo.project.name}-asset-pdf.png` });
    await page.setViewportSize({ width: 390, height: 664 });
    await page.getByRole("button", { name: "Close file preview" }).click();
    await page.getByRole("button", { name: "Open file: Image example" }).click();
    await expect.poll(() => page.locator(".lh-asset-image").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(200);
    if (testInfo.project.use.browserName === 'chromium') {
      const imageSurface = page.getByLabel("Image gestures", { exact: true });
      await imageSurface.tap();
      await imageSurface.tap();
      await expect(page.getByLabel("Zoom level", { exact: true })).not.toHaveText('100%');
      const beforePan = await imageSurface.locator('.lh-zoom-content').getAttribute('style');
      await touchGesture(page, imageSurface, 'left');
      expect(await imageSurface.locator('.lh-zoom-content').getAttribute('style')).not.toBe(beforePan);
      await touchGesture(page, page.getByLabel("Swipe down to close preview", { exact: true }), 'down');
    } else await page.getByRole('button', { name: 'Close file preview' }).click();
    await expect(page.getByRole("dialog", { name: /^File preview:/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Open file: Video example" }).click();
    await expect(page.locator("video")).toHaveAttribute("controls", "");
    await expect.poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.videoWidth)).toBe(160);
    await page.locator("video").evaluate((video: HTMLVideoElement) => video.play());
    await expect.poll(() => page.locator("video").evaluate((video: HTMLVideoElement) => video.currentTime)).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Close file preview" }).click();
    await page.getByRole("button", { name: "Open file: Audio example" }).click();
    await expect(page.locator("audio")).toHaveAttribute("controls", "");
    await expect.poll(() => page.locator("audio").evaluate((audio: HTMLAudioElement) => audio.readyState)).toBeGreaterThan(0);
    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("link", { name: "Download file" }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("sound.wav");
    expect((await readFile((await download.path())!)).subarray(0, 4).toString()).toBe("RIFF");
    await page.getByRole("button", { name: "Close file preview" }).click();
    await page.getByRole("button", { name: "Close file list", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await fetch(`${origin}/api/threads/${sourceThread.id}`, { method: "DELETE", headers: { "x-liteharness-device-id": "pwa:assets-test" } });
    await fetch(`${origin}/api/threads`, { method: "POST", headers: { "content-type": "application/json", "x-liteharness-device-id": "pwa:assets-test" }, body: JSON.stringify({ title: "Find files", workspacePath: directory }) });
    await page.reload();
    await page.getByLabel("Prompt", { exact: true }).fill("Find my previous coverage file");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByRole("button", { name: "Open file: Coverage notes" })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Open file: Coverage notes" }).click();
    await expect(page.locator(".lh-asset-text")).toContainText("bluebird");
    await page.getByRole("button", { name: "Close file preview" }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(errors).toEqual([]);
    expect(leakedRequests).toEqual([]);
    expect(compatibilityWorkers).toBeGreaterThan(0);
    const pdfSearch = await fetch(`${origin}/api/assets?q=Second`, { headers: { "x-liteharness-device-id": "pwa:assets-test" } });
    expect((await pdfSearch.json()).assets).toEqual([expect.objectContaining({ title: "PDF report", searchStatus: "partial" })]);
    await page.getByLabel("Prompt", { exact: true }).fill("Find OpenWrite record");
    await page.getByRole("button", { name: "Run", exact: true }).click();
    await expect(page.getByRole("button", { name: "Open file: OpenWrite record" })).toBeVisible();
    await page.reload();
    await page.getByRole("button", { name: "Open file: OpenWrite record" }).click();
    const provenance = page.getByLabel("OpenWrite record source");
    await expect(provenance).toContainText("invalid when shared");
    await expect(provenance).toContainText("revision 3");
    await expect(provenance).toContainText("Superseded by renewal");
    await expect(page.getByRole("navigation", { name: "PDF pages" })).toContainText("1 / 2");
    await page.screenshot({ path: `test-results/${testInfo.project.name}-openwrite-record.png` });
    await page.getByRole("button", { name: "Close file preview" }).click();
    await page.screenshot({ path: `test-results/${testInfo.project.name}-assets.png` });
  } finally {
    if (child.exitCode === null && child.signalCode === null) { const exited = once(child, "exit"); child.kill(); await exited; }
    await rm(directory, { recursive: true, force: true });
  }
});
