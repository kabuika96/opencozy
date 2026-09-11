import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TimelineEntry } from "./TimelineEntry";
import { buildTimelineRenderEntries } from "./timelinePresenter";
import type { TimelineEventRecord } from "../api";

afterEach(cleanup);

it("keeps full command output accessible after events are grouped into a reasoning disclosure", () => {
  const event: TimelineEventRecord = {
    id: "command", createdAt: "2026-09-06T00:00:00Z", threadId: "thread", runId: "run", sequence: 1,
    type: "harness.status", payload: { liteharnessType: "execution", command: "npm test", aggregatedOutput: "passed 12 checks", status: "completed", exitCode: 0 },
  };
  const entries = buildTimelineRenderEntries([event]);
  expect(entries[0]?.type).toBe("reasoning-summary");
  render(<TimelineEntry activeThread={null} busy={false} entry={entries[0]!} onApprovalDecision={vi.fn()} onInputResponse={vi.fn()} />);
  expect(screen.getByText("passed 12 checks")).toBeDefined();
  expect(screen.getByLabelText("Command").textContent).toBe("npm test");
});

it('renders a shared file as a durable standalone card between messages', () => {
  const event: TimelineEventRecord = { id: 'asset-event', createdAt: '2026-09-10T00:00:00Z', threadId: 'thread', runId: 'run', sequence: 1, type: 'asset.shared', payload: { liteharnessType: 'file-asset', asset: { id: 'asset-1', title: 'Insurance report', description: 'Coverage dates', name: 'report.pdf', kind: 'pdf', size: 100 } } };
  const entries = buildTimelineRenderEntries([event]);
  expect(entries[0]?.type).toBe('file-asset');
  render(<TimelineEntry activeThread={null} busy={false} entry={entries[0]!} onApprovalDecision={vi.fn()} onInputResponse={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Open file: Insurance report' })).toBeDefined();
});
