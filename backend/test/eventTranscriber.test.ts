import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { codexGptProviderStatus } from "../src/model/chatgptCodexModel.js";
import { createEventTranscriber, fallbackTranscript } from "../src/transcription/eventTranscriber.js";
import type { HarnessEvent } from "../src/harnesses/types.js";

const previousEnv: Record<string, string | undefined> = {};
const trackedEnv = [
  "CODEX_HOME",
  "HOME",
  "HERMES_HOME",
  "LITEHARNESS_CHATGPT_AUTH_STORE",
  "LITEHARNESS_CHATGPT_TOKEN",
  "LITEHARNESS_MODEL",
  "LITEHARNESS_MODEL_REASONING_EFFORT",
  "LITEHARNESS_MODEL_TOKEN",
  "LITEHARNESS_TRANSCRIPTION_MODEL",
  "LITEHARNESS_TRANSCRIPTION_REASONING_EFFORT",
  "USERPROFILE",
];

let cleanupPath: string | null = null;

beforeEach(() => {
  captureEnv();
});

afterEach(() => {
  for (const key of trackedEnv) {
    if (previousEnv[key] === undefined) delete process.env[key];
    else process.env[key] = previousEnv[key];
  }
  if (cleanupPath) {
    rmSync(cleanupPath, { recursive: true, force: true });
    cleanupPath = null;
  }
});

describe("event transcriber", () => {
  it("defaults the Opencozy model to Astra", () => {
    expect(codexGptProviderStatus()).toMatchObject({
      model: "gpt-6-astra",
      reasoningEffort: "xhigh",
    });
  });

  it("creates deterministic mobile summaries synchronously", () => {
    const event: HarnessEvent = {
      payload: {
        command: "npm run check",
        exitCode: 0,
        liteharnessType: "execution",
        status: "completed",
      },
      text: "npm run check (completed)",
      type: "harness.status",
    };

    const transcribed = createEventTranscriber().transcribe(event, {
      runId: "run-1",
      threadId: "thread-1",
      workspacePath: "/tmp",
    });

    expect(transcribed).not.toBeInstanceOf(Promise);
    expect(transcribed.payload?.transcript).toMatchObject({
      action: "npm run check",
      resultSummary: "Completed successfully",
      source: "fallback",
    });
  });

  it("detects an unexpired token from a Codex auth store", () => {
    cleanupPath = mkdtempSync(path.join(tmpdir(), "liteharness-codex-home-"));
    const codexHome = path.join(cleanupPath, ".codex");
    writeFileSync(path.join(cleanupPath, "placeholder"), "");
    process.env.CODEX_HOME = codexHome;
    writeFileSyncRecursive(path.join(codexHome, "auth.json"), `${JSON.stringify({ auth_mode: "chatgpt", tokens: { access_token: fakeJwt(Math.floor(Date.now() / 1000) + 3600) } }, null, 2)}\n`);

    expect(codexGptProviderStatus()).toMatchObject({
      configured: true,
      tokenExpired: false,
      tokenPresent: true,
      tokenSource: "chatgpt-login",
    });
  });

  it("creates HTML fallback summaries for mobile rendering", () => {
    const transcript = fallbackTranscript({
      payload: {
        items: [{ completed: true, text: "Add tests" }, { completed: false, text: "Refine UI" }],
        liteharnessType: "todo-list",
      },
      text: "Plan updated",
      type: "harness.status",
    });

    expect(transcript.actionHtml).toContain("<span>Update plan</span>");
    expect(transcript.resultHtml).toContain("lh-event-info");
    expect(transcript.resultSummary).toBe("1/2 done");
  });

  it("creates compact subagent summaries", () => {
    const transcript = fallbackTranscript({
      payload: {
        agentStatus: "running",
        collabTool: "spawnAgent",
        liteharnessType: "subagent",
      },
      text: "Spawn 2 agents.",
      type: "harness.status",
    });

    expect(transcript.action).toBe("Spawn subagent");
    expect(transcript.resultSummary).toBe("Running");
  });
});

function captureEnv(): void {
  for (const key of trackedEnv) {
    previousEnv[key] = process.env[key];
  }
  for (const key of trackedEnv) {
    delete process.env[key];
  }
}

function writeFileSyncRecursive(filePath: string, value: string): void {
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, value);
}

function fakeJwt(exp: number, accountId?: string): string {
  const payload = {
    exp,
    ...(accountId ? { "https://api.openai.com/auth": { chatgpt_account_id: accountId } } : {}),
  };
  return ["header", Buffer.from(JSON.stringify(payload)).toString("base64url"), "signature"].join(".");
}
