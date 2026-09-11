import { describe, expect, it } from "vitest";
import {
  buildTimelineRenderEntries,
  timelineEventLabel,
  timelineEventText,
  timelineEventTone,
  type HarnessOutputType,
} from "./timelinePresenter";
import type { TimelineEventRecord } from "../api";

describe("timeline presenter", () => {
  it("stacks files across response commentary, preserving the first card and other entries", () => {
    const assetEvent = (id: string) => event(id, { type: 'asset.shared', payload: {
      liteharnessType: 'file-asset', stableKey: `asset:${id}`,
      asset: { id, title: id, name: `${id}.pdf`, kind: 'pdf', size: 10 },
    } });
    const first = assetEvent('file-1');
    const initial = buildTimelineRenderEntries([first]);
    const entries = buildTimelineRenderEntries([first,
      event('comment', { type: 'harness.output', payload: { text: 'Here are the documents.' } }),
      assetEvent('file-2'),
    ]);
    expect(entries.map(entry => entry.type)).toEqual(['file-asset', 'assistant-message']);
    expect(entries[0]?.id).toBe(initial[0]?.id);
    expect(entries[0]?.assets?.map(asset => asset.id)).toEqual(['file-1', 'file-2']);
    expect(initial[0]?.assets).toHaveLength(1);
  });
  it('keeps repeated files after steering, other Runs, and agent branches in separate stacks', () => {
    const file = (id: string, assetId: string, runId = 'run-1', agentThreadId = 'main') => event(id, { runId, type: 'asset.shared', payload: {
      liteharnessType: 'file-asset', stableKey: `asset:${assetId}`, agentThreadId,
      asset: { id: assetId, title: assetId, name: `${assetId}.pdf`, kind: 'pdf', size: 10 },
    } });
    const entries = buildTimelineRenderEntries([
      file('1', 'a'), file('2', 'a'), file('3', 'b'),
      file('4', 'child', 'run-1', 'child'),
      event('steer', { type: 'run.steered', payload: { text: 'Show them again' } }),
      file('5', 'a'), file('6', 'c'), file('7', 'a', 'run-2'),
    ]);
    expect(entries.filter(entry => entry.type === 'file-asset').map(entry => entry.assets?.map(asset => asset.id)))
      .toEqual([['a', 'b'], ['child'], ['a', 'c'], ['a']]);
    expect(entries.filter(entry => entry.type === 'user-prompt')).toHaveLength(1);
  });
  it("uses readable labels and event payload text", () => {
    expect(timelineEventLabel({ type: "run.started" })).toBe("Started");
    expect(timelineEventLabel({ type: "run.submitted" })).toBe("You");
    expect(timelineEventLabel({ type: "thread.started" })).toBe("Thread");
    expect(timelineEventText({ type: "harness.output", payload: { text: "hello" } })).toBe("hello");
  });

  it("maps timeline events to mobile presentation tones", () => {
    expect(timelineEventTone({ type: "run.submitted", payload: {} })).toBe("query");
    expect(timelineEventTone({ type: "run.steered", payload: {} })).toBe("query");
    expect(timelineEventTone({ type: "harness.output", payload: {} })).toBe("answer");
    expect(timelineEventTone({ type: "harness.status", payload: {} })).toBe("progress");
  });

  it("merges updated execution events into one render entry", () => {
    const entries = buildTimelineRenderEntries([
      event("event-1", {
        payload: {
          command: "npm run check",
          liteharnessType: "execution",
          stableKey: "codex:item:exec-1",
          status: "in_progress",
          text: "npm run check (in_progress)",
        },
      }),
      event("event-2", {
        payload: {
          aggregatedOutput: "ok",
          command: "npm run check",
          exitCode: 0,
          liteharnessType: "execution",
          stableKey: "codex:item:exec-1",
          status: "completed",
          text: "npm run check (completed)",
        },
      }),
    ]);

    expect(entries).toHaveLength(1);
    const first = entries[0];
    expect(first).toBeDefined();
    if (!first) throw new Error("Expected one render entry");
    expect(first.type).toBe("reasoning-summary" satisfies HarnessOutputType);
    expect(first.children).toHaveLength(1);
    expect(first.children[0]).toMatchObject({
      aggregatedOutput: "ok",
      command: "npm run check",
      exitCode: 0,
      id: "event-1",
      status: "completed",
      title: "Ran",
      type: "execution" satisfies HarnessOutputType,
    });
  });

  it("keeps the current running event inside reasoning summaries", () => {
    const entries = buildTimelineRenderEntries([
      event("event-1", {
        payload: {
          command: "npm run check",
          liteharnessType: "execution",
          stableKey: "codex:item:exec-1",
          status: "in_progress",
        },
      }),
    ]);

    expect(entries[0]?.type).toBe("reasoning-summary");
    expect(entries[0]?.status).toBe("in_progress");
    expect(entries[0]?.children[0]?.title).toBe("Running");
  });

  it("keeps the tail reasoning summary open while awaiting a reply", () => {
    const entries = buildTimelineRenderEntries([
      event("event-1", {
        payload: {
          command: "npm run check",
          exitCode: 0,
          liteharnessType: "execution",
          stableKey: "codex:item:exec-1",
          status: "completed",
        },
      }),
    ]);

    expect(entries[0]?.type).toBe("reasoning-summary");
    expect(entries[0]?.status).toBe("in_progress");
  });

  it("prefers LiteHarness event transcripts for mobile summaries", () => {
    const entries = buildTimelineRenderEntries([
      event("event-1", {
        payload: {
          command: "npm run check",
          liteharnessType: "execution",
          transcript: {
            action: "Run project checks",
            actionHtml: 'Run <code>npm run check</code>',
            resultHtml: '<span class="lh-event-ok">Checks passed</span>',
            resultSummary: "Checks passed",
            source: "model",
          },
        },
      }),
    ]);

    expect(entries[0]?.type).toBe("reasoning-summary");
    expect(entries[0]?.transcriptSource).toBe("model");
    expect(entries[0]?.children[0]?.action).toBe("Run project checks");
    expect(entries[0]?.children[0]?.resultSummary).toBe("Checks passed");
    expect(entries[0]?.children[0]?.transcriptSource).toBe("model");
  });

  it("reconstructs older fallback execution transcript titles as command-only", () => {
    const entries = buildTimelineRenderEntries([
      event("event-1", {
        payload: {
          command: "npm run check",
          liteharnessType: "execution",
          transcript: {
            action: "Ran npm run check",
            actionHtml: "Ran <code>npm run check</code>",
            resultHtml: '<span class="lh-event-ok">Completed successfully</span>',
            resultSummary: "Completed successfully",
            source: "fallback",
          },
        },
      }),
    ]);

    expect(entries[0]?.type).toBe("reasoning-summary");
    expect(entries[0]?.children[0]?.action).toBe("npm run check");
    expect(entries[0]?.children[0]?.actionHtml).toBe("<code>npm run check</code>");
  });

  it("collapses harness events between replies into alternating reasoning and response rows", () => {
    const entries = buildTimelineRenderEntries([
      event("event-1", {
        payload: {
          text: "Make it smaller",
        },
        type: "run.submitted",
      }),
      event("event-2", {
        payload: {
          command: "sed -n '1,20p' src/app.ts",
          liteharnessType: "execution",
          stableKey: "codex:item:read-1",
          status: "completed",
        },
      }),
      event("event-3", {
        payload: {
          codexItem: {
            text: "Done.",
            type: "agent_message",
          },
          text: "Done.",
        },
        type: "harness.output",
      }),
      event("event-4", {
        payload: {
          liteharnessType: "file-change",
          changes: [{ kind: "modified", path: "src/app.ts" }],
          text: "modified src/app.ts",
        },
      }),
    ]);

    expect(entries.map((entry) => entry.type)).toEqual([
      "user-prompt",
      "reasoning-summary",
      "assistant-message",
      "reasoning-summary",
    ]);
    expect(entries[1]?.resultSummary).toContain("read 1 file");
    expect(entries[3]?.resultSummary).toContain("wrote 1 file");
  });

  it("hides startup lifecycle status rows from the rendered timeline", () => {
    const entries = buildTimelineRenderEntries([
      event("event-1", {
        payload: {
          liteharnessType: "lifecycle",
          stableKey: "thread:thread-1:lifecycle",
          text: "Codex thread started.",
        },
        type: "thread.started",
      }),
      event("event-2", {
        payload: {
          liteharnessType: "lifecycle",
          stableKey: "run:run-1:lifecycle",
          text: "Codex run started.",
        },
        type: "run.started",
      }),
      event("event-3", {
        payload: {
          command: "sed -n '1,20p' src/app.ts",
          liteharnessType: "execution",
          stableKey: "codex:item:read-1",
          status: "completed",
        },
      }),
      event("event-4", {
        payload: {
          liteharnessType: "lifecycle",
          stableKey: "run:run-1:lifecycle",
          text: "Codex run complete.",
        },
        type: "run.completed",
      }),
    ]);

    expect(entries.map((entry) => entry.type)).toEqual([
      "reasoning-summary",
      "lifecycle",
    ]);
    expect(entries[0]?.children.map((child) => child.type)).toEqual(["execution"]);
    expect(entries[1]?.event?.type).toBe("run.completed");
  });

  it("adds a short narrative summary to reasoning rows", () => {
    const entries = buildTimelineRenderEntries([
      event("event-1", {
        payload: {
          command: "sed -n '1,20p' frontend/src/mobile/shell/MobileShell.tsx",
          liteharnessType: "execution",
          stableKey: "codex:item:read-1",
          status: "completed",
        },
      }),
      event("event-2", {
        payload: {
          command: "npm run check",
          liteharnessType: "execution",
          stableKey: "codex:item:check-1",
          status: "completed",
        },
      }),
      event("event-3", {
        payload: {
          liteharnessType: "file-change",
          changes: [{ kind: "modified", path: "frontend/src/mobile/shell/MobileShell.tsx" }],
          text: "modified frontend/src/mobile/shell/MobileShell.tsx",
        },
      }),
    ]);

    expect(entries[0]?.type).toBe("reasoning-summary");
    expect(entries[0]?.summaryText).toBe([
      "Reviewed shell/MobileShell.tsx.",
      "Changed shell/MobileShell.tsx, then ran 1 command.",
    ].join("\n"));
    expect(entries[0]?.summaryHtml).toContain("<br>");
  });

  it("renders subagent activity with deterministic agent labels and status", () => {
    const entries = buildTimelineRenderEntries([
      event("event-1", {
        payload: {
          agentNickname: "Scout",
          agentRole: "explorer",
          agentStatus: "running",
          agentsStates: {
            "thread-scout": { status: "running" },
          },
          collabTool: "spawn_agent",
          liteharnessType: "subagent",
          receiverThreadIds: ["thread-scout"],
          stableKey: "codex:item:collab-1",
          text: "spawn_agent",
        },
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe("reasoning-summary");
    expect(entries[0]?.children[0]).toMatchObject({
      action: "Start Scout (explorer)",
      resultSummary: "1 subagent running",
      title: "Subagent",
      type: "subagent" satisfies HarnessOutputType,
    });
  });

  it("counts unique subagents in reasoning distribution and narrative summaries", () => {
    const entries = buildTimelineRenderEntries([
      event("event-1", {
        payload: {
          agentNickname: "Scout",
          agentRole: "explorer",
          agentStatus: "completed",
          agentsStates: {
            "thread-scout": { status: "completed" },
          },
          collabTool: "spawn_agent",
          liteharnessType: "subagent",
          receiverThreadIds: ["thread-scout"],
          stableKey: "codex:item:collab-1",
        },
      }),
      event("event-2", {
        payload: {
          agentStatus: "running",
          agentsStates: {
            "thread-reviewer": { status: "running" },
            "thread-scout": { status: "completed" },
          },
          collabTool: "wait",
          liteharnessType: "subagent",
          receiverThreadIds: ["thread-scout", "thread-reviewer"],
          stableKey: "codex:item:collab-2",
        },
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.resultSummary).toContain("2 subagents");
    expect(entries[0]?.summaryText).toContain("Coordinated 2 subagents.");
  });

  it("can infer stable output types from legacy codex item payloads", () => {
    const entries = buildTimelineRenderEntries([
      event("event-1", {
        payload: {
          codexItem: {
            aggregated_output: "",
            command: "ls -la",
            id: "exec-legacy",
            status: "in_progress",
            type: "command_execution",
          },
          text: "ls -la (in_progress)",
        },
      }),
      event("event-2", {
        payload: {
          codexItem: {
            aggregated_output: "total 16",
            command: "ls -la",
            id: "exec-legacy",
            status: "completed",
            type: "command_execution",
          },
          text: "ls -la (completed)",
        },
      }),
    ]);

    expect(entries).toHaveLength(1);
    const first = entries[0];
    expect(first).toBeDefined();
    if (!first) throw new Error("Expected one render entry");
    expect(first.type).toBe("reasoning-summary");
    expect(first.children[0]?.type).toBe("execution");
    expect(first.children[0]?.aggregatedOutput).toBe("total 16");
  });

  it("keeps transient waiting state out of durable render entries", () => {
    expect(buildTimelineRenderEntries([])).toEqual([]);
  });

  it("renders context compaction as a first-class timeline row", () => {
    const entries = buildTimelineRenderEntries([
      event("event-1", {
        payload: {
          liteharnessType: "compaction",
          stableKey: "thread:thread-1:compaction:1",
          text: "Earlier context compacted.",
          transcript: {
            action: "Compact context",
            actionHtml: "<span>Compact context</span>",
            resultHtml: '<span class="lh-event-info">3 events summarized</span>',
            resultSummary: "3 events summarized",
            source: "fallback",
          },
        },
        runId: null,
        type: "thread.compacted",
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      action: "Compact context",
      resultSummary: "3 events summarized",
      status: "completed",
      title: "Context",
      type: "compaction" satisfies HarnessOutputType,
    });
  });

  it("renders harness input requests as first-class prompt input rows", () => {
    const entries = buildTimelineRenderEntries([
      event("event-1", {
        payload: {
          inputRequestId: "input-1",
          liteharnessType: "input",
          questions: [{
            allowOther: true,
            header: "Mode",
            id: "mode",
            isSecret: false,
            options: [
              { description: "Keep it narrow", label: "Small" },
              { description: "Allow broader cleanup", label: "Broad" },
            ],
            question: "How should Codex proceed?",
          }],
          text: "Choose a mode",
        },
        type: "input.requested",
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      inputRequestId: "input-1",
      questions: [expect.objectContaining({ id: "mode", question: "How should Codex proceed?" })],
      title: "Input",
      type: "input" satisfies HarnessOutputType,
    });
  });

  it("keeps approval ids on first-class approval rows", () => {
    const entries = buildTimelineRenderEntries([
      event("event-1", {
        payload: {
          approvalId: "approval-1",
          liteharnessType: "approval",
          text: "Allow Gmail to send this email?",
        },
        type: "approval.requested",
      }),
    ]);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      approvalId: "approval-1",
      title: "Approval",
      type: "approval" satisfies HarnessOutputType,
    });
  });

  it("retains unchanged render entry identities while streaming a delta", () => {
    const transcript = Array.from({ length: 400 }, (_, index) => event(`history-${index}`, {
      payload: { liteharnessType: "assistant-message", text: `Reply ${index}` },
      sequence: index,
    }));
    const initial = buildTimelineRenderEntries(transcript);
    const delta = event("delta", {
      payload: { liteharnessType: "assistant-message", text: "Newest reply" },
      sequence: 401,
    });
    const streamed = buildTimelineRenderEntries([...transcript, delta]);

    // An appended delta reuses the cached event projections instead of making
    // 400 new render entry objects for the retained transcript.
    expect(streamed).toHaveLength(401);
    expect(streamed[0]).toBe(initial[0]);
    expect(streamed[399]).toBe(initial[399]);
  });

  it("scopes stable keys by run and agent lineage", () => {
    const entries = buildTimelineRenderEntries([
      event("main", { payload: { agentThreadId: "main-agent", liteharnessType: "assistant-message", stableKey: "message-1", text: "Main" } }),
      event("child", { payload: { agentThreadId: "child-agent", liteharnessType: "assistant-message", stableKey: "message-1", text: "Child" } }),
      event("next-run", { payload: { agentThreadId: "main-agent", liteharnessType: "assistant-message", stableKey: "message-1", text: "Next" }, runId: "run-2" }),
    ]);

    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.text)).toEqual(["Main", "Child", "Next"]);
  });

  it("marks only answered input and approval requests as resolved", () => {
    const entries = buildTimelineRenderEntries([
      event("input-old", { payload: { inputRequestId: "input-old", liteharnessType: "input", questions: [], text: "Old input" }, type: "input.requested" }),
      event("input-answer", { payload: { inputRequestId: "input-old", liteharnessType: "user-prompt", text: "Answered old input" }, type: "input.responded" }),
      event("approval-old", { payload: { approvalId: "approval-old", liteharnessType: "approval", text: "Old approval" }, type: "approval.requested" }),
      event("approval-answer", { payload: { approvalId: "approval-old", liteharnessType: "user-prompt", text: "Approved" }, type: "approval.responded" }),
      event("input-new", { payload: { inputRequestId: "input-new", liteharnessType: "input", questions: [], text: "Current input" }, type: "input.requested" }),
      event("approval-new", { payload: { approvalId: "approval-new", liteharnessType: "approval", text: "Current approval" }, type: "approval.requested" }),
    ]);

    expect(entries.filter((entry) => entry.type === "input").map((entry) => [entry.inputRequestId, entry.interactionStatus])).toEqual([
      ["input-old", "resolved"], ["input-new", "pending"],
    ]);
    expect(entries.filter((entry) => entry.type === "approval").map((entry) => [entry.approvalId, entry.interactionStatus])).toEqual([
      ["approval-old", "resolved"], ["approval-new", "pending"],
    ]);
  });
});

function event(id: string, overrides: Partial<TimelineEventRecord> = {}): TimelineEventRecord {
  return {
    createdAt: `2026-05-12T00:00:0${id.at(-1) ?? "0"}.000Z`,
    id,
    payload: {},
    runId: "run-1",
    sequence: Number(id.at(-1) ?? 0),
    threadId: "thread-1",
    type: "harness.status",
    ...overrides,
  };
}
