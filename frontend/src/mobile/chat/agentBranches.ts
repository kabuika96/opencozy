import type { TimelineEventRecord } from "../api";

export type AgentBranch = {
  activityCount: number;
  id: string;
  label: string;
  lastActivity: string | null;
  parentId: string | null;
  role: string | null;
  status: string;
  task: string | null;
};

export type AgentBranchBreadcrumb = { id: string | null; label: string };

export type AgentBranchSummary = {
  completed: number;
  failed: number;
  pending: number;
  running: number;
  total: number;
};

export function buildAgentBranches(events: TimelineEventRecord[], mainThreadId: string): AgentBranch[] {
  const branches = new Map<string, AgentBranch>();
  for (const event of events) {
    const payload = event.payload;
    const agentThreadId = readString(payload.agentThreadId);
    if (agentThreadId) {
      upsertBranch(branches, {
        activity: activityForEvent(payload),
        id: agentThreadId,
        label: readString(payload.agentNickname) ?? readString(payload.agentRole) ?? agentPathLabel(readString(payload.agentPath)),
        parentId: normalizeParentId(readString(payload.parentThreadId), mainThreadId),
        role: readString(payload.agentRole),
        status: readExplicitAgentStatus(payload),
        task: readAgentTask(payload),
      });
    }

    const agentStates = readRecord(payload.agentsStates);
    for (const receiverThreadId of readStringList(payload.receiverThreadIds)) {
      if (receiverThreadId === agentThreadId || receiverThreadId === mainThreadId) continue;
      const state = readRecord(agentStates?.[receiverThreadId]);
      upsertBranch(branches, {
        activity: activityForEvent(payload),
        id: receiverThreadId,
        label: readString(state?.nickname) ?? readString(state?.name),
        // A collaboration receiver can be a peer, parent, or child. Only an
        // explicit adapter parentThreadId establishes the branch lineage.
        parentId: null,
        role: readString(state?.role),
        status: readString(state?.status),
        task: readString(state?.task) ?? receiverTask(payload),
      });
    }
  }
  return Array.from(branches.values());
}

export function summarizeAgentBranches(branches: AgentBranch[]): AgentBranchSummary {
  return branches.reduce<AgentBranchSummary>((summary, branch) => {
    summary.total += 1;
    if (branch.status === "completed" || branch.status === "shutdown") summary.completed += 1;
    else if (branch.status === "failed" || branch.status === "errored" || branch.status === "interrupted") summary.failed += 1;
    else if (branch.status === "pending" || branch.status === "pendingInit") summary.pending += 1;
    else summary.running += 1;
    return summary;
  }, { completed: 0, failed: 0, pending: 0, running: 0, total: 0 });
}

export function timelineForAgentBranch(events: TimelineEventRecord[], branchId: string | null): TimelineEventRecord[] {
  return events.filter((event) => {
    const eventBranchId = readString(event.payload.agentThreadId);
    return branchId === null ? eventBranchId === null : eventBranchId === branchId;
  });
}

export function agentBranchBreadcrumbs(branches: AgentBranch[], branchId: string | null): AgentBranchBreadcrumb[] {
  const breadcrumbs: AgentBranchBreadcrumb[] = [{ id: null, label: "Main" }];
  if (!branchId) return breadcrumbs;
  const byId = new Map(branches.map((branch) => [branch.id, branch]));
  const lineage: AgentBranch[] = [];
  const visited = new Set<string>();
  let current = byId.get(branchId);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    lineage.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return [...breadcrumbs, ...lineage.map((branch) => ({ id: branch.id, label: branch.label }))];
}

function upsertBranch(branches: Map<string, AgentBranch>, input: {
  activity: string | null;
  id: string;
  label: string | null;
  parentId: string | null;
  role: string | null;
  status: string | null;
  task: string | null;
}): void {
  const existing = branches.get(input.id);
  branches.set(input.id, {
    activityCount: (existing?.activityCount ?? 0) + 1,
    id: input.id,
    label: input.label ?? existing?.label ?? fallbackAgentLabel(input.id),
    lastActivity: input.activity ?? existing?.lastActivity ?? null,
    parentId: input.parentId ?? existing?.parentId ?? null,
    role: input.role ?? existing?.role ?? null,
    status: normalizeStatus(input.status ?? existing?.status),
    task: input.task ?? existing?.task ?? null,
  });
}

function normalizeParentId(parentId: string | null, mainThreadId: string): string | null {
  return !parentId || parentId === mainThreadId ? null : parentId;
}

function normalizeStatus(status: string | null | undefined): string {
  if (status === "in_progress" || status === "inProgress" || status === "active") return "running";
  return status ?? "pending";
}

function readExplicitAgentStatus(payload: Record<string, unknown>): string | null {
  return readString(payload.agentStatus) ?? readString(readRecord(payload.agentState)?.status);
}

function readAgentTask(payload: Record<string, unknown>): string | null {
  return readString(payload.agentTask) ?? readString(payload.task) ?? readString(payload.agentPrompt);
}

function receiverTask(payload: Record<string, unknown>): string | null {
  const tool = readString(payload.collabTool)?.replace(/[_-]/g, "").toLowerCase();
  return tool === "spawnagent" || tool === "spawn" ? readString(payload.prompt) : null;
}

function activityForEvent(payload: Record<string, unknown>): string | null {
  return readString(payload.activity) ?? readString(payload.text) ?? readString(readRecord(payload.transcript)?.action);
}

function fallbackAgentLabel(id: string): string {
  return `Agent ${id.replaceAll("-", "").slice(-4)}`;
}

function agentPathLabel(agentPath: string | null): string | null {
  const path = agentPath?.split("/").filter(Boolean) ?? [];
  const leaf = path.length > 1 ? path.at(-1) : null;
  if (!leaf) return null;
  const words = leaf.replace(/[_-]+/g, " ");
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim())) : [];
}
