import { describe, expect, it } from "vitest";
import type { TimelineEventRecord } from "../api";
import {
  agentBranchBreadcrumbs,
  buildAgentBranches,
  summarizeAgentBranches,
  timelineForAgentBranch,
} from "./agentBranches";

describe("agent branches", () => {
  it("builds nested agent navigation and separates child work from the main line", () => {
    const events = [
      event("main-prompt", {
        liteharnessType: "user-prompt",
        text: "Build it",
      }),
      event("spawn", {
        collabTool: "spawnAgent",
        liteharnessType: "subagent",
        receiverThreadIds: ["agent-1"],
        text: "Spawn 1 agent",
      }),
      event("agent-start", {
        agentNickname: "Scout",
        agentRole: "explorer",
        agentStatus: "running",
        agentThreadId: "agent-1",
        liteharnessType: "subagent",
        parentThreadId: "main-thread",
        text: "Scout started",
      }),
      event("agent-output", {
        agentNickname: "Scout",
        agentRole: "explorer",
        agentThreadId: "agent-1",
        liteharnessType: "assistant-message",
        parentThreadId: "main-thread",
        text: "Mapped the code",
      }),
      event("nested-output", {
        agentNickname: "Builder",
        agentRole: "worker",
        agentStatus: "completed",
        agentThreadId: "agent-2",
        liteharnessType: "assistant-message",
        parentThreadId: "agent-1",
        text: "Built the slice",
      }),
    ];

    expect(buildAgentBranches(events, "main-thread")).toEqual([
      expect.objectContaining({
        id: "agent-1",
        label: "Scout",
        parentId: null,
        role: "explorer",
        status: "running",
      }),
      expect.objectContaining({
        id: "agent-2",
        label: "Builder",
        parentId: "agent-1",
        role: "worker",
        status: "completed",
      }),
    ]);
    expect(timelineForAgentBranch(events, null).map((item) => item.id)).toEqual([
      "main-prompt",
      "spawn",
    ]);
    expect(timelineForAgentBranch(events, "agent-1").map((item) => item.id)).toEqual([
      "agent-start",
      "agent-output",
    ]);
    expect(agentBranchBreadcrumbs(
      buildAgentBranches(events, "main-thread"),
      "agent-2",
    ).map((item) => item.label)).toEqual(["Main", "Scout", "Builder"]);
  });

  it("uses distinct task names for unnamed UUIDv7 subagents", () => {
    const events = [
      event("first-agent", {
        agentPath: "/root/budget_search",
        agentThreadId: "019fa780-bd62-7aa2-9116-3ec4245aa982",
        liteharnessType: "subagent",
      }),
      event("second-agent", {
        agentPath: "/root/contractor_search",
        agentThreadId: "019fa780-a85d-7942-9b42-0a0640bce22b",
        liteharnessType: "subagent",
      }),
    ];

    expect(buildAgentBranches(events, "main-thread").map((branch) => branch.label)).toEqual([
      "Budget search",
      "Contractor search",
    ]);
  });

  it("uses the varying UUID suffix when no task name is available", () => {
    const events = [
      event("first-agent", {
        agentThreadId: "019fa780-bd62-7aa2-9116-3ec4245aa982",
        liteharnessType: "subagent",
      }),
      event("second-agent", {
        agentThreadId: "019fa780-a85d-7942-9b42-0a0640bce22b",
        liteharnessType: "subagent",
      }),
    ];

    expect(buildAgentBranches(events, "main-thread").map((branch) => branch.label)).toEqual([
      "Agent a982",
      "Agent e22b",
    ]);
  });

  it("does not turn an inter-agent send into a parent-child relationship or tool status", () => {
    const branches = buildAgentBranches([
      event("agent-a", {
        agentNickname: "Planner",
        agentStatus: "running",
        agentTask: "Map the integration",
        agentThreadId: "agent-a",
        liteharnessType: "subagent",
        parentThreadId: "main-thread",
        text: "Reviewing boundaries",
      }),
      event("peer-send", {
        agentsStates: { "agent-b": { status: "pending", task: "Wait for a decision" } },
        liteharnessType: "tool-call",
        receiverThreadIds: ["agent-b"],
        senderThreadId: "agent-a",
        status: "completed",
        text: "Sent context to Builder",
      }),
      event("agent-b", {
        agentNickname: "Builder",
        agentStatus: "running",
        agentThreadId: "agent-b",
        liteharnessType: "assistant-message",
        parentThreadId: "agent-a",
        text: "Implementing the shell",
      }),
    ], "main-thread");

    expect(branches).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "agent-a",
        activityCount: 1,
        lastActivity: "Reviewing boundaries",
        parentId: null,
        status: "running",
        task: "Map the integration",
      }),
      expect.objectContaining({
        id: "agent-b",
        activityCount: 2,
        parentId: "agent-a",
        status: "running",
        task: "Wait for a decision",
      }),
    ]));
    expect(summarizeAgentBranches(branches)).toEqual({ completed: 0, failed: 0, pending: 0, running: 2, total: 2 });
  });

  it("does not create Main as an agent and only gives spawned receivers their prompt task", () => {
    const branches = buildAgentBranches([
      event("send-main", {
        agentThreadId: "scout",
        collabTool: "sendInput",
        prompt: "This is a message, not Scout's task",
        receiverThreadIds: ["main-thread"],
      }),
      event("spawn-builder", {
        collabTool: "spawnAgent",
        prompt: "Review the keyboard behavior",
        receiverThreadIds: ["builder"],
      }),
    ], "main-thread");

    expect(branches.map(branch => branch.id)).toEqual(["scout", "builder"]);
    expect(branches.find(branch => branch.id === "scout")?.task).toBeNull();
    expect(branches.find(branch => branch.id === "builder")?.task).toBe("Review the keyboard behavior");
  });
});

function event(id: string, payload: Record<string, unknown>): TimelineEventRecord {
  return {
    createdAt: "2026-07-27T00:00:00.000Z",
    id,
    payload,
    runId: "run-1",
    sequence: 1,
    threadId: "main-thread",
    type: payload.liteharnessType === "user-prompt" ? "run.submitted" : "harness.status",
  };
}
