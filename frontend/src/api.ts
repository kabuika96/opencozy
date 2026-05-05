import type {
  AppShortcut,
  AppShortcutInput,
  CodexCapabilities,
  OpenCozySessionMode,
  OpenCozySessionSummary,
  WanTunnelStatus
} from "./types";

export type CreateOpenCozySessionOptions = {
  codexThreadId?: string;
  cwd?: string;
  deviceId?: string;
  name?: string;
};

export type RenameOpenCozySessionInput = {
  name: string;
};

export type ListOpenCozySessionsOptions = {
  deviceId: string;
  tabIds?: string[];
};

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (init?.body !== undefined && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(url, {
    ...init,
    headers
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error || `${response.status} ${response.statusText}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

export function getCodexCapabilities(): Promise<CodexCapabilities> {
  return request<CodexCapabilities>("/api/codex");
}

export function getWanTunnelStatus(): Promise<WanTunnelStatus> {
  return request<WanTunnelStatus>("/api/wan-tunnel");
}

export function listOpenCozySessions(options: ListOpenCozySessionsOptions): Promise<OpenCozySessionSummary[]> {
  const params = new URLSearchParams();
  params.set("deviceId", options.deviceId);
  for (const tabId of options.tabIds ?? []) {
    params.append("tabId", tabId);
  }

  return request<OpenCozySessionSummary[]>(`/api/open-cozy-sessions?${params.toString()}`);
}

export function createOpenCozySession(mode: OpenCozySessionMode, options: CreateOpenCozySessionOptions = {}): Promise<OpenCozySessionSummary> {
  return request<OpenCozySessionSummary>("/api/open-cozy-sessions", {
    method: "POST",
    body: JSON.stringify({
      mode,
      ...(options.codexThreadId ? { codexThreadId: options.codexThreadId } : {}),
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.deviceId ? { deviceId: options.deviceId } : {}),
      ...(options.name ? { name: options.name } : {})
    })
  });
}

export function updateOpenCozySession(id: string, input: RenameOpenCozySessionInput): Promise<OpenCozySessionSummary> {
  return request<OpenCozySessionSummary>(`/api/open-cozy-sessions/${id}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function closeOpenCozySession(id: string): Promise<void> {
  return request<void>(`/api/open-cozy-sessions/${id}`, { method: "DELETE" });
}

export function listApps(): Promise<AppShortcut[]> {
  return request<AppShortcut[]>("/api/apps");
}

export function createApp(input: AppShortcutInput): Promise<AppShortcut> {
  return request<AppShortcut>("/api/apps", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateApp(id: string, input: AppShortcutInput): Promise<AppShortcut> {
  return request<AppShortcut>(`/api/apps/${id}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function deleteApp(id: string): Promise<void> {
  return request<void>(`/api/apps/${id}`, { method: "DELETE" });
}
