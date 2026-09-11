import { stat } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import type { HarnessAdapter } from "../harnesses/types.js";
import type { WorkspaceDiscovery } from "../types.js";

export class WorkspaceDiscoveryError extends Error {
  constructor(message: string, readonly statusCode = 404) {
    super(message);
  }
}

export async function discoverWorkspace(input: {
  adapter: HarnessAdapter;
  defaultWorkspacePath: string;
  description: string;
}): Promise<WorkspaceDiscovery> {
  const description = input.description.trim();
  if (!description) {
    throw new WorkspaceDiscoveryError("Workspace description is required", 400);
  }

  const discovery = await input.adapter.discoverWorkspace({
    defaultWorkspacePath: input.defaultWorkspacePath,
    description,
  });
  const workspacePath = normalizeWorkspacePath(discovery.workspacePath, input.defaultWorkspacePath);
  if (!await isDirectory(workspacePath)) {
    throw new WorkspaceDiscoveryError("Workspace discovery returned a path that is not a directory");
  }

  return {
    explanation: discovery.explanation.trim() || "Matched workspace",
    title: discovery.title.trim() || titleFromWorkspace(workspacePath),
    workspacePath,
  };
}

function normalizeWorkspacePath(path: string, homePath: string): string {
  const trimmed = path.trim();
  if (trimmed === "~") {
    return homePath;
  }
  if (trimmed.startsWith("~/")) {
    return join(homePath, trimmed.slice(2));
  }
  if (isAbsolute(trimmed)) {
    return trimmed;
  }
  return resolve(homePath, trimmed);
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function titleFromWorkspace(workspacePath: string): string {
  return basename(workspacePath) || "Workspace";
}
