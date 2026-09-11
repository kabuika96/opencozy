import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applyCompactionHandoffToPrompt,
  createThreadCompactor,
  latestCompactionHandoff,
  planThreadCompaction,
} from "../src/compaction/threadCompactor.js";
import { createStore, type LiteHarnessStore } from "../src/db/store.js";
import type { RunCodexGptJsonInput } from "../src/model/chatgptCodexModel.js";
import type { TimelineEventRecord } from "../src/types.js";

let cleanupPath: string | null = null;
let store: LiteHarnessStore | null = null;

afterEach(() => {
  store?.close();
  store = null;
  if (cleanupPath) {
    rmSync(cleanupPath, { recursive: true, force: true });
    cleanupPath = null;
  }
});

function makeStore(): LiteHarnessStore {
  cleanupPath = mkdtempSync(join(tmpdir(), "liteharness-compactor-"));
  store = createStore(join(cleanupPath, "liteharness.sqlite"));
  return store;
}

describe("thread compactor", () => {
  it("keeps fallback progress as unverified context, includes steering, and invents no project constraints", async () => {
    const current = makeStore();
    const thread = current.createThread({ harnessThreadId: null, harnessType: "codex", title: "Garden plan", workspacePath: "/tmp" });
    const run = current.createRun({ prompt: "Plan my garden", threadId: thread.id });
    const entries = [
      ["run.submitted", { liteharnessType: "user-prompt", text: "Plan my garden" }],
      ["harness.output", { liteharnessType: "assistant-message", text: "I will check the soil before planting." }],
      ["run.steered", { liteharnessType: "user-prompt", text: "Keep the existing trees" }],
      ["harness.status", { liteharnessType: "todo-list", items: [{ text: "Inspect soil", completed: false }] }],
      ["harness.output", { liteharnessType: "assistant-message", text: "Still checking." }],
    ] as const;
    for (const [type, payload] of entries) {
      current.recordTimelineEvent({ payload, runId: run.id, threadId: thread.id, type });
    }
    const compactor = createThreadCompactor({
      config: { protectFirstEvents: 0, protectLastEvents: 1, tailTokenBudget: 0, thresholdTokens: 1 },
      runModelJson: async () => { throw new Error("model unavailable"); },
      store: current,
    });

    const result = await compactor.compactThread({ thread, trigger: "manual" });
    expect(result.event?.payload.source).toBe("fallback");
    expect(result.event?.payload.summaryJson).toMatchObject({
      activeTask: "Keep the existing trees",
      constraints: [],
      done: [],
      goal: "Plan my garden",
      remainingWork: ["Inspect soil"],
    });
    const handoff = latestCompactionHandoff(current, thread.id)!;
    expect(handoff).toContain("I will check the soil before planting.");
    expect(handoff).not.toContain("Keep Harness SDK details behind backend adapters");
    expect(handoff).toContain("unverified");
  });

  it("wraps a handoff around the latest user prompt without changing empty handoffs", () => {
    expect(applyCompactionHandoffToPrompt(" Continue ", null)).toBe("Continue");
    expect(applyCompactionHandoffToPrompt("Continue", "Summary")).toBe([
      "<liteharness-context-compaction>",
      "Summary",
      "</liteharness-context-compaction>",
      "",
      "<latest-user-message>",
      "Continue",
      "</latest-user-message>",
    ].join("\n"));
  });

  it("protects the head and tail while selecting middle history for compaction", () => {
    const events = Array.from({ length: 6 }, (_, index) => timelineEvent(index + 1));

    const plan = planThreadCompaction(events, {
      enabled: true,
      protectFirstEvents: 2,
      protectLastEvents: 2,
      tailTokenBudget: 0,
      thresholdTokens: 1,
    });

    expect(plan.shouldCompact).toBe(true);
    expect(plan.preservedHeadCount).toBe(2);
    expect(plan.preservedTailCount).toBe(2);
    expect(plan.compactedEvents.map((event) => event.sequence)).toEqual([3, 4]);
  });

  it("keeps the latest human-authored event visible even when compacting surrounding middle history", async () => {
    const current = makeStore();
    const thread = current.createThread({
      harnessThreadId: "codex-thread-1",
      harnessType: "codex",
      title: "Opencozy",
      workspacePath: "/tmp",
    });
    const run = current.createRun({ prompt: "older prompt", threadId: thread.id });
    current.recordTimelineEvent({
      payload: { liteharnessType: "user-prompt", text: "first prompt" },
      runId: run.id,
      threadId: thread.id,
      type: "run.submitted",
    });
    current.recordTimelineEvent({
      payload: { liteharnessType: "assistant-message", text: "older answer" },
      runId: run.id,
      threadId: thread.id,
      type: "harness.output",
    });
    current.recordTimelineEvent({
      payload: { liteharnessType: "user-prompt", text: "latest human message" },
      runId: run.id,
      threadId: thread.id,
      type: "run.steered",
    });
    current.recordTimelineEvent({
      payload: { command: "npm test", liteharnessType: "execution", text: "test output" },
      runId: run.id,
      threadId: thread.id,
      type: "harness.status",
    });
    current.recordTimelineEvent({
      payload: { liteharnessType: "assistant-message", text: "Tail stays visible." },
      runId: run.id,
      threadId: thread.id,
      type: "harness.output",
    });

    let modelReasoningEffort: string | undefined;
    const compactor = createThreadCompactor({
      config: {
        enabled: true,
        protectFirstEvents: 1,
        protectLastEvents: 1,
        tailTokenBudget: 0,
        thresholdTokens: 1,
      },
      runModelJson: async <T>(input: RunCodexGptJsonInput) => {
        modelReasoningEffort = input.reasoningEffort;
        return {
          activeTask: "Continue from latest human message.",
          blocked: [],
          constraints: ["Keep Harness SDK details behind backend adapters."],
          criticalContext: [],
          decisions: [],
          done: [],
          goal: "Preserve human context through compaction.",
          remainingWork: [],
          relevantFiles: [],
        } as T;
      },
      store: current,
    });

    const result = await compactor.compactThread({ thread, trigger: "manual" });
    const visible = current.listTimeline(thread.id);

    expect(result.compactedEventCount).toBe(2);
    expect(result.event?.payload.summarizedEventCount).toBe(3);
    expect(visible.map((event) => event.type)).toEqual([
      "run.submitted",
      "thread.compacted",
      "run.steered",
      "harness.output",
    ]);
    expect(visible.map((event) => event.payload.text)).toContain("latest human message");
    expect(modelReasoningEffort).toBe("xhigh");
  });

  it("replaces visible middle history with a durable compaction handoff", async () => {
    const current = makeStore();
    const thread = current.createThread({
      harnessThreadId: "codex-thread-1",
      harnessType: "codex",
      title: "Opencozy",
      workspacePath: "/tmp",
    });
    const run = current.createRun({ prompt: "older prompt", threadId: thread.id });
    current.recordTimelineEvent({
      payload: { liteharnessType: "user-prompt", text: "first prompt" },
      runId: run.id,
      threadId: thread.id,
      type: "run.submitted",
    });
    current.recordTimelineEvent({
      payload: { command: "sed -n '1,20p' backend/src/routes/api.ts", liteharnessType: "execution" },
      runId: run.id,
      threadId: thread.id,
      type: "harness.status",
    });
    current.recordTimelineEvent({
      payload: { liteharnessType: "assistant-message", text: "Added compaction scaffolding." },
      runId: run.id,
      threadId: thread.id,
      type: "harness.output",
    });
    current.recordTimelineEvent({
      payload: { liteharnessType: "user-prompt", text: "continue" },
      runId: run.id,
      threadId: thread.id,
      type: "run.submitted",
    });
    current.recordTimelineEvent({
      payload: { liteharnessType: "assistant-message", text: "Tail stays visible." },
      runId: run.id,
      threadId: thread.id,
      type: "harness.output",
    });

    const compactor = createThreadCompactor({
      config: {
        enabled: true,
        protectFirstEvents: 1,
        protectLastEvents: 1,
        tailTokenBudget: 0,
        thresholdTokens: 1,
      },
      runModelJson: async <T>() => ({
        activeTask: "Wire compaction into run submission.",
        blocked: [],
        constraints: ["Keep Harness SDK details behind backend adapters."],
        criticalContext: ["Prompt handoff belongs outside the stored user prompt."],
        decisions: ["Use a Opencozy-owned handoff event."],
        done: ["Read context and ADRs."],
        goal: "Implement context compaction.",
        remainingWork: ["Add regression tests."],
        relevantFiles: [{ note: "Run submission path", path: "backend/src/routes/api.ts" }],
      }) as T,
      store: current,
    });

    const result = await compactor.compactThread({ thread, trigger: "manual" });
    const visible = current.listTimeline(thread.id);

    expect(result.compactedEventCount).toBe(2);
    expect(result.event?.type).toBe("thread.compacted");
    expect(result.event?.payload.summarizedEventCount).toBe(3);
    expect(visible.map((event) => event.type)).toEqual([
      "run.submitted",
      "thread.compacted",
      "run.submitted",
      "harness.output",
    ]);
    expect(latestCompactionHandoff(current, thread.id)).toContain("Goal: Implement context compaction.");
    expect(latestCompactionHandoff(current, thread.id)).toContain("backend/src/routes/api.ts");
    expect(current.getThread(thread.id)?.harnessThreadId).toBeNull();
  });

  it("keeps automatic compaction off the model hot path", async () => {
    const current = makeStore();
    const thread = current.createThread({
      harnessThreadId: "codex-thread-1",
      harnessType: "codex",
      title: "Opencozy",
      workspacePath: "/tmp",
    });
    const run = current.createRun({ prompt: "ship it", threadId: thread.id });
    for (const [index, text] of ["first prompt", "older output", "latest output"].entries()) {
      current.recordTimelineEvent({
        payload: {
          liteharnessType: index === 0 ? "user-prompt" : "assistant-message",
          text,
        },
        runId: run.id,
        threadId: thread.id,
        type: index === 0 ? "run.submitted" : "harness.output",
      });
    }
    const compactor = createThreadCompactor({
      config: {
        enabled: true,
        protectFirstEvents: 1,
        protectLastEvents: 1,
        tailTokenBudget: 0,
        thresholdTokens: 1,
      },
      runModelJson: async () => {
        throw new Error("automatic compaction must not call the model");
      },
      store: current,
    });

    const result = await compactor.compactThread({ thread, trigger: "auto" });

    expect(result.event?.payload.source).toBe("fallback");
    expect(result.compactedEventCount).toBe(1);
  });
});

function timelineEvent(sequence: number): TimelineEventRecord {
  return {
    createdAt: `2026-05-12T00:00:${String(sequence).padStart(2, "0")}.000Z`,
    id: `event-${sequence}`,
    payload: {
      liteharnessType: "execution",
      text: `event ${sequence}`,
    },
    runId: "run-1",
    sequence,
    threadId: "thread-1",
    type: "harness.status",
  };
}
