import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentCommunications, communicationsFor } from "./AgentCommunications";
import type { AgentBranch } from "./agentBranches";
import type { TimelineEventRecord } from "../api";

const branches: AgentBranch[] = [
  { activityCount: 1, id: "scout", label: "Scout", lastActivity: null, parentId: null, role: "explorer", status: "running", task: null },
  { activityCount: 1, id: "builder", label: "Builder", lastActivity: null, parentId: null, role: "worker", status: "running", task: null },
];
const events: TimelineEventRecord[] = [
  event("old", { collabTool: "sendInput", prompt: "old version", receiverThreadIds: ["builder"], senderThreadId: "scout", stableKey: "message-1", status: "in_progress" }),
  event("latest", { collabTool: "sendInput", prompt: "Use the checked API", receiverThreadIds: ["builder"], senderThreadId: "scout", stableKey: "message-1", status: "completed" }),
  event("spawn", { collabTool: "spawnAgent", prompt: "Review the CSS", receiverThreadIds: ["scout"], senderThreadId: "main", status: "in_progress" }),
];

describe("AgentCommunications", () => {
  afterEach(cleanup);
  it("dedupes revisions and filters a child to its inbound and outbound messages", () => {
    expect(communicationsFor(events, "builder").map(message => message.body)).toEqual(["Use the checked API"]);
    const onSelect = vi.fn();
    render(<AgentCommunications branches={branches} events={events} mainThreadId="main" selectedBranchId={null} onSelect={onSelect} />);
    expect(screen.getByText("Agent messages · 2")).toBeDefined();
    fireEvent.click(screen.getByText("Agent messages · 2"));
    expect(screen.getByText("Use the checked API")).toBeDefined();
    expect(screen.queryByText("old version")).toBeNull();
    expect(screen.getByText("delivered")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Builder" }));
    expect(onSelect).toHaveBeenCalledWith("builder");
    fireEvent.click(screen.getByRole("button", { name: "Main" }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("uses child lineage or Main instead of the LiteHarness storage thread id", () => {
    const messages = communicationsFor([
      event("child-origin", { agentThreadId: "scout", collabTool: "sendInput", prompt: "Check the adapter", receiverThreadIds: ["builder"] }),
      event("main-origin", { collabTool: "spawnAgent", prompt: "Inspect UI", receiverThreadIds: ["scout"] }),
    ], null);
    expect(messages.map(message => message.sender)).toEqual(["scout", "__liteharness_main__"]);

    render(<AgentCommunications branches={branches} events={[event("main-origin", { collabTool: "spawnAgent", prompt: "Inspect UI", receiverThreadIds: ["scout"] })]} mainThreadId="harness-main" selectedBranchId={null} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByText("Agent messages · 1"));
    expect(screen.getByRole("button", { name: "Main" })).toBeDefined();
  });
});

function event(id: string, payload: Record<string, unknown>): TimelineEventRecord {
  return { createdAt: "2026-01-01T00:00:00.000Z", id, payload, runId: "run-1", sequence: 1, threadId: "main", type: "harness.status" };
}
