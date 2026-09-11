import { expect, test, type Page, type WebSocketRoute } from "@playwright/test";
import type { ThreadRecord, TimelineEventRecord } from "../src/mobile/api";

async function mockHarness(page: Page, long = false) {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const threads: ThreadRecord[] = ["LiteHarness", "Website", "Research", "Notes"].map((title, index) => ({
    id: `thread-${index}`, title, workspacePath: `/projects/${title.toLowerCase()}`, harnessType: "codex", harnessThreadId: `main-${index}`,
    status: index === 0 ? "running" : "idle", fastMode: true, profileId: "default", wiredPreviewId: null,
    createdAt: "2026-09-06T00:00:00Z", updatedAt: "2026-09-06T00:00:00Z",
  }));
  const closed = new Set<string>();
  const sockets = new Map<string, WebSocketRoute>();
  const requests: Array<{ path: string; body: unknown }> = [];
  let sequence = 0;
  const event = (threadId: string, type: string, text: string, payload: Record<string, unknown> = {}): TimelineEventRecord => ({
    id: `event-${++sequence}`, sequence, createdAt: new Date(Date.now() - 20_000).toISOString(), threadId, runId: "run-1", type, payload: { text, ...payload },
  });
  const events = new Map<string, TimelineEventRecord[]>(threads.map(thread => [thread.id, []]));
  events.set("thread-0", [
    event("thread-0", "run.submitted", "Improve the mobile experience and coordinate the agents.", { liteharnessType: "user-prompt" }),
    event("thread-0", "harness.output", "<small class='lh-html-muted'>Checking the interaction and rendering paths.</small>", { liteharnessType: "assistant-message" }),
    event("thread-0", "harness.status", "Send task to Builder", { liteharnessType: "subagent", collabTool: "sendInput", senderThreadId: "main-0", receiverThreadIds: ["worker"], prompt: "Keep the keyboard and scrolling changes focused.", status: "completed" }),
    event("thread-0", "harness.status", "Implement mobile interactions", { liteharnessType: "subagent", agentThreadId: "worker", parentThreadId: "main-0", agentNickname: "Builder", agentRole: "Implementation", agentStatus: "running" }),
    event("thread-0", "harness.output", "<p>Keyboard and scrolling now share one viewport.</p>", { liteharnessType: "assistant-message", agentThreadId: "worker", agentStatus: "running" }),
    event("thread-0", "harness.status", "Check regressions", { liteharnessType: "subagent", agentThreadId: "reviewer", parentThreadId: "main-0", agentNickname: "Reviewer", agentRole: "Validation", agentStatus: "completed" }),
    event("thread-0", "harness.output", "<p><strong>Mobile controls are ready.</strong></p><ul><li>Close tabs with undo</li><li>Message a running agent</li><li>Keep your place while output streams</li></ul><details><summary>Validation</summary><p>Keyboard, scrolling, rendering, and recovery.</p></details>", { liteharnessType: "assistant-message" }),
  ]);
  if (long) for (let index = 0; index < 160; index++) events.get("thread-0")!.push(event("thread-0", "harness.output", `<p>Update ${index}: a useful line of output while the agent works.</p>`, { liteharnessType: "assistant-message" }));
  await page.routeWebSocket("**/api/ws?**", socket => {
    const id = new URL(socket.url()).searchParams.get("threadId")!;
    sockets.set(id, socket);
    socket.send(JSON.stringify({ type: "heartbeat", serverTime: new Date().toISOString() }));
  });
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const body = route.request().postData() ? JSON.parse(route.request().postData()!) : undefined;
    requests.push({ path, body });
    let result: unknown;
    if (path === "/api/config") result = { defaultWorkspacePath: "/projects", defaultProfileId: "default", profiles: [
      { id: "default", label: "Balance", model: "gpt-6-astra", reasoningEffort: "high", subagentModel: "gpt-6-astra", subagentReasoningEffort: "high", fastMode: true, description: "Astra subagents with high reasoning" },
      { id: "speed", label: "Speed", model: "gpt-6-astra", reasoningEffort: "medium", subagentModel: "gpt-6-astra", subagentReasoningEffort: "low", fastMode: true, description: "Astra subagents with low reasoning" },
      { id: "power", label: "Power", model: "gpt-6-astra", reasoningEffort: "max", subagentModel: "gpt-6-astra", subagentReasoningEffort: "xhigh", fastMode: false, description: "Astra subagents with xhigh reasoning" },
    ] };
    else if (path === "/api/harnesses") result = [{ type: "codex", label: "Codex", capabilities: { fastMode: true, approvals: true, streaming: true, userInput: true } }];
    else if (path === "/api/workspaces/discover/stream") {
      await route.fulfill({ contentType: "application/x-ndjson", body: [
        { type: "workspace.search.started", text: "Searching workspace" },
        { type: "workspace.search.found", text: "Found Mobile project", discovery: { title: "Mobile project", workspacePath: "/projects/mobile-app/a-long-directory-name/another-long-folder", explanation: "Matched folder path" } },
      ].map(event => JSON.stringify(event)).join("\n") });
      return;
    }
    else if (path === "/api/threads" && method === "POST") {
      const created: ThreadRecord = { ...threads[1]!, ...body, id: `thread-${threads.length}`, harnessThreadId: null, status: "idle" };
      threads.unshift(created);
      events.set(created.id, []);
      result = created;
    }
    else if (path === "/api/threads") result = threads.filter(t => !closed.has(t.id));
    else if (path === "/api/threads/closed") result = threads.filter(t => closed.has(t.id));
    else if (path === "/api/threads/close") {
      expect(route.request().headers()["content-type"]).toContain("application/json");
      const closedIds = body.threadIds.filter((id: string) => threads.some(t => t.id === id && t.status === "idle"));
      closedIds.forEach((id: string) => closed.add(id));
      result = { closedIds, skippedIds: body.threadIds.filter((id: string) => !closedIds.includes(id)) };
    } else if (path.endsWith("/reopen")) { const id = path.split("/")[3]!; closed.delete(id); result = threads.find(t => t.id === id); }
    else if (path.endsWith("/timeline")) result = events.get(path.split("/")[3]!) ?? [];
    else if (path.endsWith("/state")) { const id = path.split("/")[3]!; result = { thread: threads.find(t => t.id === id), timeline: events.get(id), serverTime: new Date().toISOString() }; }
    else if (method === "POST" && path.endsWith("/input")) {
      const id = path.split("/")[3]!;
      const child = path.includes("/agents/") ? path.split("/")[6] : null;
      const next = event(id, "run.steered", body.prompt, { liteharnessType: "user-prompt", ...(child ? { agentThreadId: child } : {}) });
      events.get(id)!.push(next);
      result = { ok: true, event: next };
    }
    else if (method === "POST" && path.includes("/approval/")) {
      const id = path.split("/")[3]!;
      const next = event(id, "approval.responded", body.approved ? "Allowed" : "Denied", { approvalId: "restart-test", approved: body.approved, liteharnessType: "user-prompt" });
      events.get(id)!.push(next);
      threads.find(thread => thread.id === id)!.status = "running";
      result = { ok: true };
    }
    else if (path.endsWith("/cancel")) { const thread = threads.find(t => t.id === path.split("/")[3]); if (thread) thread.status = "idle"; result = { ok: true }; }
    else result = [];
    await route.fulfill({ json: result });
  });
  return { errors, requests, requestApproval() {
    threads[0]!.status = "needs_approval";
    events.get("thread-0")!.push(event("thread-0", "approval.requested", "Restart LiteHarness backend? Active runs will stop.", { approvalId: "restart-test", liteharnessType: "approval", requestMethod: "liteharness/requestApproval" }));
  }, send(text: string) {
    const next = event("thread-0", "harness.output", `<p>${text}</p>`, { liteharnessType: "assistant-message" });
    events.get("thread-0")!.push(next);
    sockets.get("thread-0")?.send(JSON.stringify({ type: "timeline.event", event: next }));
  } };
}

test("canceling attachment selection keeps composer geometry and the reading position stable", async ({ page }) => {
  const harness = await mockHarness(page, true);
  await page.goto("/");
  await expect(page.getByText(/Update 159:/)).toBeVisible();
  await page.getByLabel("Prompt", { exact: true }).fill("Keep this draft");
  await page.getByRole("button", { name: "Hide keyboard" }).click();
  await page.locator(".lh-mobile-chat-content").evaluate(content => { content.scrollTop -= 400; content.dispatchEvent(new Event("scroll")); });
  await expect(page.getByRole("button", { name: "Scroll to bottom" })).toBeVisible();
  const before = await page.locator(".lh-mobile-composer-footer").boundingBox();
  const top = await page.locator(".lh-mobile-chat-content").evaluate(content => content.scrollTop);
  // Chromium lets us exercise cancel/focus repeatedly, but does not render iOS's source popover.
  for (let attempt = 0; attempt < 5; attempt++) {
    const picker = page.getByLabel("Attach files", { exact: true });
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), picker.click()]);
    expect(await chooser.element().boundingBox()).toEqual(await picker.boundingBox());
    await chooser.setFiles([]);
    await page.waitForTimeout(75);
    await expect(page.getByRole("button", { name: "Hide keyboard" })).toHaveCount(0);
    await page.locator(".lh-mobile-chat-content").click({ position: { x: 10, y: 10 } });
    expect(await page.locator(".lh-mobile-composer-footer").boundingBox()).toEqual(before);
    expect(await page.locator(".lh-mobile-chat-content").evaluate(content => content.scrollTop)).toBe(top);
    await expect(page.getByLabel("Prompt", { exact: true })).toHaveValue("Keep this draft");
  }
  expect(harness.requests.filter(request => request.path.endsWith("/attachments") || request.path.endsWith("/cancel"))).toHaveLength(0);
  expect(harness.errors).toEqual([]);
});

test("mobile layout, tab close/undo, bulk management and agent navigation", async ({ page }, testInfo) => {
  const harness = await mockHarness(page);
  await page.goto("/");
  await expect(page.getByText("Mobile controls are ready.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const send = await page.getByRole("button", { name: "Steer", exact: true }).boundingBox();
  const composer = await page.locator(".lh-mobile-composer").boundingBox();
  expect(send!.y).toBeGreaterThanOrEqual(composer!.y);
  expect(send!.y + send!.height).toBeLessThanOrEqual(composer!.y + composer!.height + 1);
  await page.screenshot({ path: `test-results/${testInfo.project.name}-chat.png` });
  await page.getByRole("tab", { name: "Switch to Website", exact: true }).click();
  await page.getByRole("button", { name: "Thread menu for Website", exact: true }).click();
  await page.getByRole("button", { name: "Close thread", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Switch to Website", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Active thread Website", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Switch to LiteHarness", exact: true }).click();
  await page.getByRole("button", { name: "Manage tabs", exact: true }).click();
  await page.getByRole("button", { name: "Close tab Website", exact: true }).click();
  await expect(page.getByRole("button", { name: "Open Website", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: /Close idle/ }).click();
  await expect(page.getByRole("button", { name: "Open LiteHarness", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open Notes", exact: true })).toHaveCount(0);
  await page.getByRole("tab", { name: "Recently closed" }).click();
  await page.screenshot({ path: `test-results/${testInfo.project.name}-tabs.png` });
  await page.getByRole("button", { name: "Reopen Notes", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Active thread Notes" })).toBeVisible();
  await page.getByRole("tab", { name: "Switch to LiteHarness" }).click();
  await page.getByRole("button", { name: "Show agents" }).click();
  await page.getByRole("button", { name: "Open Builder, running" }).click();
  await expect(page.getByText("Keyboard and scrolling now share one viewport.")).toBeVisible();
  await expect(page.getByText("Mobile controls are ready.")).toHaveCount(0);
  await page.screenshot({ path: `test-results/${testInfo.project.name}-agents.png` });
  expect(harness.errors).toEqual([]);
});

for (const width of [390, 320]) test(`new tab settings, discovery and recent workspaces at ${width}px`, async ({ page }, testInfo) => {
  const harness = await mockHarness(page);
  await page.setViewportSize({ width, height: 844 });
  await page.goto("/");
  await page.getByLabel("Prompt", { exact: true }).fill("Keep this draft");
  await page.getByRole("button", { name: "New tab" }).click();
  await expect(page.getByRole("heading", { name: "New tab" })).toBeVisible();
  await expect(page.getByText("Working", { exact: true })).toHaveCount(0);
  const settings = page.locator(".lh-new-thread-settings");
  await expect(settings.locator("summary")).toContainText("gpt-6-astra");
  await expect(settings.locator("summary")).toContainText("Balance · high · Fast");
  await page.screenshot({ path: `test-results/${testInfo.project.name}-new-tab-${width}.png` });
  await page.getByRole("button", { name: "Back to threads" }).click();
  await expect(page.getByLabel("Prompt", { exact: true })).toHaveValue("Keep this draft");
  await page.getByRole("button", { name: "New tab" }).click();
  await page.getByLabel("Model and settings", { exact: true }).click();
  await expect(page.getByRole("button", { name: "Power profile" })).toBeVisible();
  await expect(page.getByRole("button", { name: / profile$/ })).toHaveCount(3);
  for (const [label, main, child] of [["Balance", "high", "high"], ["Speed", "medium", "low"], ["Power", "max", "xhigh"]]) {
    await expect(page.getByRole("button", { name: `${label} profile` })).toContainText(`Main ${main} · Subagents ${child}`);
  }
  await page.getByRole("button", { name: "Power profile" }).click();
  const fast = page.getByRole("switch", { name: "Fast mode for new tab" });
  await expect(fast).not.toBeChecked();
  await fast.click();
  await expect(fast).toBeChecked();
  await page.getByRole("button", { name: "Balance profile" }).click();
  await expect(settings.locator("summary")).toContainText("Balance");
  await expect(page.getByRole("button", { name: "Balance profile" })).toContainText("gpt-6-astra");
  await page.screenshot({ path: `test-results/${testInfo.project.name}-new-tab-settings-${width}.png` });
  expect(await settings.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.getByRole("button", { name: "Power profile" }).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.getByLabel("Model and settings", { exact: true }).click();
  await page.getByRole("tab", { name: "Find workspace", exact: true }).click();
  await expect(page.getByText("Paste a folder path or describe a project below.")).toBeVisible();
  await page.getByRole("textbox", { name: "Workspace", exact: true }).fill("/projects/mobile-app");
  await page.setViewportSize({ width, height: 430 });
  await expect.poll(async () => {
    const composer = await page.locator(".lh-mobile-composer").boundingBox();
    return composer!.y + composer!.height;
  }).toBeLessThanOrEqual(430);
  await page.getByRole("button", { name: "Hide keyboard" }).click();
  await expect(page.getByRole("textbox", { name: "Workspace", exact: true })).not.toBeFocused();
  await page.setViewportSize({ width, height: 844 });
  await page.getByRole("button", { name: "Find workspace", exact: true }).click();
  const found = page.getByRole("button", { name: "Create thread in Mobile project" });
  await expect(found).toBeEnabled();
  await expect(found).toContainText("another-long-folder");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await found.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: `test-results/${testInfo.project.name}-new-tab-found-${width}.png` });
  await found.click();
  await expect(page.getByRole("tab", { name: "Active thread Mobile project" })).toBeVisible();
  expect(harness.requests.filter(request => request.path === "/api/threads" && request.body).at(-1)?.body).toMatchObject({
    profileId: "default", fastMode: true, title: "Mobile project", workspacePath: "/projects/mobile-app/a-long-directory-name/another-long-folder",
  });
  await page.getByRole("button", { name: "New tab" }).click();
  await page.getByRole("button", { name: "Create thread in another-long-folder" }).click();
  await expect(page.getByRole("tab", { name: "Active thread another-long-folder" })).toBeVisible();
  expect(harness.requests.filter(request => request.path === "/api/workspaces/discover/stream")).toHaveLength(1);
  expect(harness.errors).toEqual([]);
});

test("reading position survives streaming, tab switches and keyboard resizing", async ({ page }) => {
  const harness = await mockHarness(page, true);
  await page.goto("/");
  await expect(page.getByText(/Update 159:/)).toBeVisible();
  const scrollTop = () => page.locator(".lh-mobile-chat-content").evaluate(content => content.scrollTop);
  await page.locator(".lh-mobile-chat-content").evaluate(content => {
    content.scrollTop -= 900;
    content.dispatchEvent(new Event("scroll"));
  });
  await expect(page.getByRole("button", { name: "Scroll to bottom" })).toBeVisible();
  const before = await scrollTop();
  harness.send("A new streamed update");
  await page.waitForTimeout(150);
  expect(Math.abs(await scrollTop() - before)).toBeLessThan(2);
  await page.getByRole("tab", { name: "Switch to Website" }).click();
  await page.getByRole("tab", { name: "Switch to LiteHarness" }).click();
  await expect.poll(async () => Math.abs(await scrollTop() - before)).toBeLessThan(2);
  await page.locator(".lh-mobile-chat-content").evaluate(content => { content.scrollTop = 0; content.dispatchEvent(new Event("scroll")); });
  const firstVisible = page.locator(".lh-mobile-answer").first();
  const anchorText = await firstVisible.textContent();
  const anchorY = (await firstVisible.boundingBox())!.y;
  await page.getByRole("button", { name: /Show earlier/ }).click();
  await expect(page.getByRole("button", { name: /Show earlier/ })).toHaveCount(0);
  await expect.poll(async () => Math.abs((await page.getByText(anchorText!, { exact: true }).boundingBox())!.y - anchorY)).toBeLessThan(2);
  await page.getByRole("button", { name: "Scroll to bottom" }).click();
  await expect(page.getByText("A new streamed update")).toBeVisible();
  await page.getByLabel("Prompt", { exact: true }).fill("A multiline message\nthat keeps growing\nwith another line");
  await page.setViewportSize({ width: 390, height: 430 });
  await expect(page.getByRole("button", { name: "Hide keyboard" })).toBeVisible();
  // Visible-viewport measurements settle on animation frame after a resize.
  await expect.poll(async () => {
    const composer = await page.locator(".lh-mobile-composer").boundingBox();
    return composer!.y + composer!.height;
  }).toBeLessThanOrEqual(430);
  await page.getByRole("button", { name: "Hide keyboard" }).click();
  await expect(page.getByLabel("Prompt", { exact: true })).not.toBeFocused();
  expect(harness.requests.filter(r => r.path.endsWith("/cancel"))).toHaveLength(0);
  expect(harness.errors).toEqual([]);
});


test("agent messages target the selected agent; tab options stay above the keyboard", async ({ page }, testInfo) => {
  const harness = await mockHarness(page);
  await page.goto("/");
  await expect(page.getByLabel("Prompt", { exact: true })).toBeVisible();
  await page.getByLabel("Prompt", { exact: true }).fill("Main draft stays here");
  await page.getByRole("button", { name: "Show agents" }).click();
  await page.getByRole("button", { name: "Open Builder, running" }).click();
  await expect(page.getByLabel("Prompt", { exact: true })).toHaveValue("");
  await page.getByText("Agent messages · 1", { exact: true }).click();
  await expect(page.getByText("Keep the keyboard and scrolling changes focused.")).toBeVisible();
  await page.getByLabel("Prompt", { exact: true }).fill("Please verify the viewport");
  await page.getByRole("button", { name: "Send to Builder" }).click();
  await expect(page.getByText("Please verify the viewport", { exact: true })).toHaveCount(1);
  expect(harness.requests.filter(request => request.path.endsWith("/runs/agents/worker/input"))).toHaveLength(1);
  expect(harness.requests.filter(request => request.path.endsWith("/runs/input"))).toHaveLength(0);
  await page.getByRole("button", { name: "Return to Main" }).click();
  await expect(page.getByLabel("Prompt", { exact: true })).toHaveValue("Main draft stays here");
  await page.getByRole("button", { name: "Thread menu for LiteHarness" }).click();
  const options = page.getByRole("dialog", { name: "LiteHarness thread options" });
  await expect(options).toBeVisible();
  await expect(page.getByLabel("Rename", { exact: true })).not.toBeFocused();
  const box = await options.boundingBox();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  await page.screenshot({ path: `test-results/${testInfo.project.name}-options.png` });
  expect(harness.errors).toEqual([]);
});

test("close all asks before stopping active work and preserves closed history", async ({ page }) => {
  const harness = await mockHarness(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Manage tabs", exact: true }).click();
  await page.getByRole("button", { name: "Stop work & close all…", exact: true }).click();
  expect(harness.requests.filter(request => request.path.endsWith("/cancel"))).toHaveLength(0);
  await page.getByRole("button", { name: "Stop and close all", exact: true }).click();
  await expect(page.getByText("No open threads", { exact: true })).toBeVisible();
  expect(harness.requests.filter(request => request.path.endsWith("/cancel"))).toHaveLength(1);
  await page.getByRole("tab", { name: "Recently closed", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reopen LiteHarness", exact: true })).toBeVisible();
  expect(harness.errors).toEqual([]);
});

for (const approved of [true, false]) test(`restart approval card records ${approved ? "Yes" : "No"} once`, async ({ page }, testInfo) => {
  const harness = await mockHarness(page);
  harness.requestApproval();
  await page.goto("/");
  await expect(page.getByText("Restart LiteHarness backend? Active runs will stop.")).toBeVisible();
  await page.reload();
  const yes = page.getByRole("button", { name: "Yes", exact: true });
  const no = page.getByRole("button", { name: "No", exact: true });
  await expect(yes).toBeEnabled();
  await expect(no).toBeEnabled();
  await page.screenshot({ path: `test-results/${testInfo.project.name}-restart-approval-${approved}.png` });
  await (approved ? yes : no).click();
  await expect(yes).toBeDisabled();
  await expect(no).toBeDisabled();
  expect(harness.requests.filter(request => request.path.includes("/approval/"))).toEqual([
    { path: "/api/threads/thread-0/approval/restart-test", body: { approved } },
  ]);
  expect(harness.errors).toEqual([]);
});

test("Enter adds newlines and only the onscreen button submits composers", async ({ page }) => {
  const harness = await mockHarness(page);
  await page.goto("/");
  const prompt = page.getByLabel("Prompt", { exact: true });
  await prompt.fill("First line");
  await prompt.press("Enter");
  await prompt.pressSequentially("Second line");
  await expect(prompt).toHaveValue("First line\nSecond line");
  expect(harness.requests.filter(request => request.path.endsWith("/input"))).toHaveLength(0);
  await expect(prompt).toHaveAttribute("enterkeyhint", "enter");
  await page.getByRole("button", { name: "Steer", exact: true }).click();
  await expect.poll(() => harness.requests.filter(request => request.path.endsWith("/input")).length).toBe(1);
  expect(harness.requests.find(request => request.path.endsWith("/input"))?.body).toEqual({ prompt: "First line\nSecond line" });

  await page.getByRole("button", { name: "New tab" }).click();
  await page.getByRole("tab", { name: "Find workspace", exact: true }).click();
  const workspace = page.getByRole("textbox", { name: "Workspace", exact: true });
  await workspace.fill("Mobile project");
  await workspace.press("Enter");
  await workspace.pressSequentially("under projects");
  await expect(workspace).toHaveValue("Mobile project\nunder projects");
  expect(harness.requests.filter(request => request.path.includes("/discover"))).toHaveLength(0);
  await expect(workspace).toHaveAttribute("enterkeyhint", "enter");
  await page.getByRole("button", { name: "Find workspace", exact: true }).click();
  await expect(page.getByRole("button", { name: "Create thread in Mobile project" })).toBeEnabled();
  expect(harness.requests.filter(request => request.path.includes("/discover"))).toHaveLength(1);
  expect(harness.errors).toEqual([]);
});
