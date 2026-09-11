import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AgentTimelineNavigation } from "./AgentTimelineNavigation";
import type { AgentBranch } from "./agentBranches";

const branches: AgentBranch[] = [
  { activityCount: 3, id: "scout", label: "Scout", lastActivity: "Mapped files", parentId: null, role: "explorer", status: "completed", task: "Map the codebase" },
  { activityCount: 1, id: "builder", label: "Builder", lastActivity: "Editing shell", parentId: "scout", role: "worker", status: "running", task: "Build tabs" },
];

describe("AgentTimelineNavigation", () => {
  afterEach(cleanup);

  it("shows compact counts, tasks, and branch navigation", () => {
    const onSelect = vi.fn();
    render(<AgentTimelineNavigation branches={branches} selectedBranchId={null} onSelect={onSelect} />);

    expect(screen.getByText("2 agents · 1 working")).toBeDefined();
    expect(screen.queryByText("Map the codebase")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show agents" }));
    expect(screen.getByText("Map the codebase")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Open Builder, running" }));
    expect(onSelect).toHaveBeenCalledWith("builder");
  });

  it("renders nested breadcrumbs and returns to the explicit parent", () => {
    const onSelect = vi.fn();
    render(<AgentTimelineNavigation branches={branches} selectedBranchId="builder" onSelect={onSelect} />);

    fireEvent.click(screen.getByRole("button", { name: "Back to Scout" }));
    expect(onSelect).toHaveBeenCalledWith("scout");
    fireEvent.click(screen.getByRole("button", { name: "Main" }));
    expect(onSelect).toHaveBeenCalledWith(null);
  });

  it("keeps branch cards collapsed while viewing a child until explicitly expanded", () => {
    render(<AgentTimelineNavigation branches={branches} selectedBranchId="builder" onSelect={vi.fn()} />);

    expect(screen.getByText("Builder")).toBeDefined();
    expect(screen.queryByText("Build tabs")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Show agents" }));
    expect(screen.getByText("Build tabs")).toBeDefined();
  });
});
