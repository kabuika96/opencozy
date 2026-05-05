import type {
  AppShortcut,
  AppShortcutInput,
  CodexCapabilities,
  OpenCozySessionMode,
  OpenCozySessionSummary,
  PreviewManifest,
  PreviewManifestApproval,
  PreviewManifestInput,
  PreviewManifestStatus,
  PreviewPublishedOrigin,
  PreviewWiringSessionLaunch,
  WanTunnelStatus,
  WiredPreview,
  WiredPreviewInput
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

export type LaunchPreviewWiringSessionInput = {
  deviceId?: string;
  projectSearchBrief: string;
  wiredPreviewId?: string;
};

export type PreviewPublishedOriginResponse = {
  origin: PreviewPublishedOrigin | null;
  origins: PreviewPublishedOrigin[];
  wiredPreview: WiredPreview;
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

export function attachWiredPreviewToSession(id: string, wiredPreviewId: string): Promise<OpenCozySessionSummary> {
  return request<OpenCozySessionSummary>(`/api/open-cozy-sessions/${id}/wired-preview`, {
    method: "PUT",
    body: JSON.stringify({ wiredPreviewId })
  });
}

export function detachWiredPreviewFromSession(id: string): Promise<OpenCozySessionSummary> {
  return request<OpenCozySessionSummary>(`/api/open-cozy-sessions/${id}/wired-preview`, {
    method: "DELETE"
  });
}

export function closeOpenCozySession(id: string): Promise<void> {
  return request<void>(`/api/open-cozy-sessions/${id}`, { method: "DELETE" });
}

export function listWiredPreviews(search?: string): Promise<WiredPreview[]> {
  const params = new URLSearchParams();
  if (search?.trim()) {
    params.set("search", search.trim());
  }

  const query = params.toString();
  return request<WiredPreview[]>(query ? `/api/wired-previews?${query}` : "/api/wired-previews");
}

export function getWiredPreview(id: string): Promise<WiredPreview> {
  return request<WiredPreview>(`/api/wired-previews/${id}`);
}

export function createWiredPreview(input: WiredPreviewInput): Promise<WiredPreview> {
  return request<WiredPreview>("/api/wired-previews", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function updateWiredPreview(id: string, input: WiredPreviewInput): Promise<WiredPreview> {
  return request<WiredPreview>(`/api/wired-previews/${id}`, {
    method: "PUT",
    body: JSON.stringify(input)
  });
}

export function deleteWiredPreview(id: string): Promise<void> {
  return request<void>(`/api/wired-previews/${id}`, { method: "DELETE" });
}

export function listPreviewPublishedOrigins(wiredPreviewId: string): Promise<PreviewPublishedOrigin[]> {
  return request<PreviewPublishedOrigin[]>(`/api/wired-previews/${wiredPreviewId}/published-origins`);
}

export function publishPreviewTarget(wiredPreviewId: string, httpsPort?: number): Promise<PreviewPublishedOriginResponse> {
  return request<PreviewPublishedOriginResponse>(`/api/wired-previews/${wiredPreviewId}/published-origins`, {
    method: "POST",
    body: JSON.stringify({
      source: "target",
      ...(httpsPort ? { httpsPort } : {})
    })
  });
}

export function publishPreviewDependencyService(wiredPreviewId: string, dependencyServiceIndex: number, httpsPort?: number): Promise<PreviewPublishedOriginResponse> {
  return request<PreviewPublishedOriginResponse>(`/api/wired-previews/${wiredPreviewId}/published-origins`, {
    method: "POST",
    body: JSON.stringify({
      source: "dependencyService",
      dependencyServiceIndex,
      ...(httpsPort ? { httpsPort } : {})
    })
  });
}

export function publishBrowserDirectPreviewServices(wiredPreviewId: string): Promise<PreviewPublishedOriginResponse> {
  return request<PreviewPublishedOriginResponse>(`/api/wired-previews/${wiredPreviewId}/published-origins`, {
    method: "POST",
    body: JSON.stringify({ source: "browserDirectDependencyServices" })
  });
}

export function unpublishPreviewOrigin(wiredPreviewId: string, originId: string): Promise<PreviewPublishedOriginResponse> {
  return request<PreviewPublishedOriginResponse>(`/api/wired-previews/${wiredPreviewId}/published-origins/${originId}`, {
    method: "DELETE"
  });
}

export function listPreviewManifests(status?: PreviewManifestStatus): Promise<PreviewManifest[]> {
  const params = new URLSearchParams();
  if (status) {
    params.set("status", status);
  }

  const query = params.toString();
  return request<PreviewManifest[]>(query ? `/api/preview-manifests?${query}` : "/api/preview-manifests");
}

export function submitPreviewManifest(input: PreviewManifestInput): Promise<PreviewManifest> {
  return request<PreviewManifest>("/api/preview-manifests", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function approvePreviewManifest(id: string, name: string): Promise<PreviewManifestApproval> {
  return request<PreviewManifestApproval>(`/api/preview-manifests/${id}/approve`, {
    method: "PUT",
    body: JSON.stringify({ name })
  });
}

export function launchPreviewWiringSession(input: LaunchPreviewWiringSessionInput): Promise<PreviewWiringSessionLaunch> {
  return request<PreviewWiringSessionLaunch>("/api/preview-wiring-sessions", {
    method: "POST",
    body: JSON.stringify(input)
  });
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
