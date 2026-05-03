import type {
  AppShortcut,
  AppShortcutInput,
  CodexCapabilities,
  OpenCozySessionMode,
  OpenCozySessionSummary
} from "./types";

export type CreateOpenCozySessionOptions = {
  cwd?: string;
  name?: string;
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

export function listOpenCozySessions(): Promise<OpenCozySessionSummary[]> {
  return request<OpenCozySessionSummary[]>("/api/open-cozy-sessions");
}

export function createOpenCozySession(mode: OpenCozySessionMode, options: CreateOpenCozySessionOptions = {}): Promise<OpenCozySessionSummary> {
  return request<OpenCozySessionSummary>("/api/open-cozy-sessions", {
    method: "POST",
    body: JSON.stringify({
      mode,
      ...(options.cwd ? { cwd: options.cwd } : {}),
      ...(options.name ? { name: options.name } : {})
    })
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
