export type HarnessType = "codex";
export type RunStatus = "queued" | "running" | "needs_approval" | "needs_input" | "completed" | "failed" | "canceled";
export type ThreadStatus = "idle" | "running" | "needs_approval" | "needs_input" | "failed";

export type HarnessCapabilities = {
  approvals: boolean;
  fastMode: boolean;
  resume: boolean;
  streaming: boolean;
  userInput: boolean;
};

export type HarnessSummary = {
  capabilities: HarnessCapabilities;
  label: string;
  type: HarnessType;
};

export type ThreadRecord = {
  createdAt: string;
  fastMode: boolean;
  harnessThreadId: string | null;
  harnessType: HarnessType;
  id: string;
  profileId: string;
  status: ThreadStatus;
  title: string;
  updatedAt: string;
  wiredPreviewId: string | null;
  workspacePath: string;
};

export type RunRecord = {
  completedAt: string | null;
  createdAt: string;
  id: string;
  prompt: string;
  startedAt: string | null;
  status: RunStatus;
  threadId: string;
};

export type TimelineEventRecord = {
  createdAt: string;
  id: string;
  payload: Record<string, unknown>;
  runId: string | null;
  sequence: number;
  threadId: string;
  type: string;
};

export type ExecutionProfileSummary = {
  description: string;
  fastMode: boolean;
  id: string;
  label: string;
  model: string;
  reasoningEffort: string;
  subagentModel?: string;
  subagentReasoningEffort?: string;
};

export type AppConfig = {
  defaultProfileId: string;
  defaultWorkspacePath: string;
  profiles: ExecutionProfileSummary[];
};

export type WorkspaceDiscovery = {
  explanation: string;
  title: string;
  workspacePath: string;
};

export type WorkspaceDiscoveryStreamEvent =
  | {
      text: string;
      type: "workspace.search.started" | "workspace.search.status";
    }
  | {
      discovery: WorkspaceDiscovery;
      text: string;
      type: "workspace.search.found";
    }
  | {
      error?: string;
      text: string;
      type: "workspace.search.failed";
    };

export type HarnessInputOption = {
  description: string;
  label: string;
};

export type HarnessInputQuestion = {
  allowOther: boolean;
  header: string;
  id: string;
  isSecret: boolean;
  options: HarnessInputOption[] | null;
  question: string;
};

export type ThreadState = {
  serverTime: string;
  thread: ThreadRecord;
  timeline: TimelineEventRecord[];
};

export type PreviewDependencyServiceInput = {
  browserDirect: boolean;
  name: string;
  url: string;
};

export type PreviewCommandInput = {
  command: string;
  cwd: string;
  label: string;
};

export type PreviewPublishedOriginInput = {
  name: string;
  url: string;
};

export type PreviewPublishedOriginStatus = "published" | "failed" | "unpublished";

export type PreviewPublishedOrigin = {
  createdAt: string;
  dependencyServiceIndex: number | null;
  dependencyServiceName: string | null;
  error: string | null;
  httpsPort: number;
  id: string;
  localProxyPort?: number | null;
  name: string;
  provider: "tailscale-serve";
  publishedUrl: string | null;
  source: "target" | "dependency-service";
  sourceUrl: string;
  status: PreviewPublishedOriginStatus;
  updatedAt: string;
};

export type WiredPreview = {
  commands: PreviewCommandInput[];
  createdAt: string;
  dependencyServices: PreviewDependencyServiceInput[];
  id: string;
  name: string;
  projectDirectory: string;
  publishedOrigins: PreviewPublishedOrigin[];
  requestedPublishedOrigins: PreviewPublishedOriginInput[];
  target: {
    name: string;
    url: string;
  };
  updatedAt: string;
  wiringThreadId: string | null;
};

export type WiredPreviewInput = {
  commands: PreviewCommandInput[];
  dependencyServices: PreviewDependencyServiceInput[];
  name: string;
  projectDirectory: string;
  requestedPublishedOrigins: PreviewPublishedOriginInput[];
  target: {
    name: string;
    url: string;
  };
};

export type PreviewManifestStatus = "pending" | "approved";

export type PreviewManifestInput = WiredPreviewInput & {
  wiredPreviewId?: string;
  wiringThreadId?: string;
};

export type PreviewManifest = {
  approvedAt: string | null;
  approvedWiredPreviewId: string | null;
  commands: PreviewCommandInput[];
  createdAt: string;
  dependencyServices: PreviewDependencyServiceInput[];
  id: string;
  materialHash: string;
  projectDirectory: string;
  proposedName: string;
  requestedPublishedOrigins: PreviewPublishedOriginInput[];
  status: PreviewManifestStatus;
  target: {
    name: string;
    url: string;
  };
  updatedAt: string;
  wiredPreviewId: string | null;
  wiringThreadId: string | null;
};

export type PreviewManifestApproval = {
  manifest: PreviewManifest;
  wiredPreview: WiredPreview;
};

export type PreviewPublishedOriginResponse = {
  origin: PreviewPublishedOrigin | null;
  origins: PreviewPublishedOrigin[];
  wiredPreview: WiredPreview;
};

export type PreviewWiringThreadLaunch = {
  prompt: string;
  reused: boolean;
  run: RunRecord;
  thread: ThreadRecord;
  wiredPreview: WiredPreview | null;
};

export type TimelineConnectionOptions = {
  onDisconnect?: () => void;
  onHeartbeat?: (serverTime: string, threadStatus?: ThreadStatus) => void;
};

const deviceIdHeaderName = "x-liteharness-device-id";
const deviceIdStorageKey = "liteharness.deviceId.v1";
const deviceIdPattern = /^pwa:[A-Za-z0-9._:-]{1,124}$/;

export async function fetchAppConfig(): Promise<AppConfig> {
  return fetchJson("/api/config");
}

export async function fetchThreads(): Promise<ThreadRecord[]> {
  return fetchJson("/api/threads");
}

export async function fetchHarnesses(): Promise<HarnessSummary[]> {
  return fetchJson("/api/harnesses");
}

export async function createThread(input: {
  fastMode?: boolean;
  profileId?: string;
  title?: string;
  workspacePath: string;
}): Promise<ThreadRecord> {
  return fetchJson("/api/threads", {
    body: JSON.stringify({ harnessType: "codex", ...input }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export async function discoverWorkspace(input: {
  description: string;
}): Promise<WorkspaceDiscovery> {
  return fetchJson("/api/workspaces/discover", {
    body: JSON.stringify({ harnessType: "codex", ...input }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export async function* discoverWorkspaceStream(input: {
  description: string;
}, options: { signal?: AbortSignal } = {}): AsyncGenerator<WorkspaceDiscoveryStreamEvent> {
  const response = await fetch("/api/workspaces/discover/stream", withDeviceHeader({
    body: JSON.stringify({ harnessType: "codex", ...input }),
    headers: { "content-type": "application/json" },
    method: "POST",
    signal: options.signal,
  }));
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: unknown };
    throw new Error(typeof body.error === "string" ? body.error : `Request failed: ${response.status}`);
  }
  if (!response.body) {
    throw new Error("Workspace discovery stream is unavailable");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) {
          yield JSON.parse(trimmed) as WorkspaceDiscoveryStreamEvent;
        }
      }
    }
    buffer += decoder.decode();
    const trimmed = buffer.trim();
    if (trimmed) {
      yield JSON.parse(trimmed) as WorkspaceDiscoveryStreamEvent;
    }
  } finally {
    reader.releaseLock();
  }
}

export async function renameThread(threadId: string, title: string): Promise<ThreadRecord> {
  return fetchJson(`/api/threads/${threadId}`, {
    body: JSON.stringify({ title }),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

export async function updateThreadSettings(
  threadId: string,
  update: { fastMode?: boolean; profileId?: string },
): Promise<ThreadRecord> {
  return fetchJson(`/api/threads/${threadId}`, {
    body: JSON.stringify(update),
    headers: { "content-type": "application/json" },
    method: "PATCH",
  });
}

export async function closeThreads(threadIds: string[]): Promise<{ closedIds: string[]; skippedIds: string[] }> {
  return fetchJson("/api/threads/close", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ threadIds }) });
}

export async function closeThread(threadId: string): Promise<void> {
  const result = await closeThreads([threadId]);
  if (!result.closedIds.includes(threadId)) throw new Error("Thread is still working");
}

export async function fetchClosedThreads(): Promise<ThreadRecord[]> {
  return fetchJson("/api/threads/closed");
}

export async function reopenThread(threadId: string): Promise<ThreadRecord> {
  return fetchJson(`/api/threads/${threadId}/reopen`, { method: "POST" });
}

export async function listWiredPreviews(search?: string): Promise<WiredPreview[]> {
  const params = new URLSearchParams();
  if (search?.trim()) {
    params.set("search", search.trim());
  }
  const query = params.toString();
  return fetchJson(query ? `/api/wired-previews?${query}` : "/api/wired-previews");
}

export async function getWiredPreview(id: string): Promise<WiredPreview> {
  return fetchJson(`/api/wired-previews/${id}`);
}

export async function updateWiredPreview(id: string, input: WiredPreviewInput): Promise<WiredPreview> {
  return fetchJson(`/api/wired-previews/${id}`, {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });
}

export async function deleteWiredPreview(id: string): Promise<void> {
  await fetchJson(`/api/wired-previews/${id}`, { method: "DELETE" });
}

export async function attachWiredPreviewToThread(threadId: string, wiredPreviewId: string): Promise<ThreadRecord> {
  return fetchJson(`/api/threads/${threadId}/wired-preview`, {
    body: JSON.stringify({ wiredPreviewId }),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });
}

export async function detachWiredPreviewFromThread(threadId: string): Promise<ThreadRecord> {
  return fetchJson(`/api/threads/${threadId}/wired-preview`, {
    method: "DELETE",
  });
}

export async function publishPreviewTarget(wiredPreviewId: string, httpsPort?: number): Promise<PreviewPublishedOriginResponse> {
  return fetchJson(`/api/wired-previews/${wiredPreviewId}/published-origins`, {
    body: JSON.stringify({
      source: "target",
      ...(httpsPort ? { httpsPort } : {}),
    }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export async function publishBrowserDirectPreviewServices(wiredPreviewId: string): Promise<PreviewPublishedOriginResponse> {
  return fetchJson(`/api/wired-previews/${wiredPreviewId}/published-origins`, {
    body: JSON.stringify({ source: "browserDirectDependencyServices" }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export async function listPreviewManifests(status?: PreviewManifestStatus): Promise<PreviewManifest[]> {
  const params = new URLSearchParams();
  if (status) {
    params.set("status", status);
  }
  const query = params.toString();
  return fetchJson(query ? `/api/preview-manifests?${query}` : "/api/preview-manifests");
}

export async function approvePreviewManifest(id: string, name: string): Promise<PreviewManifestApproval> {
  return fetchJson(`/api/preview-manifests/${id}/approve`, {
    body: JSON.stringify({ name }),
    headers: { "content-type": "application/json" },
    method: "PUT",
  });
}

export async function launchPreviewWiringThread(input: {
  projectSearchBrief: string;
  sourceThreadId?: string;
  wiredPreviewId?: string;
}): Promise<PreviewWiringThreadLaunch> {
  return fetchJson("/api/preview-wiring-threads", {
    body: JSON.stringify(input),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export async function fetchTimeline(threadId: string): Promise<TimelineEventRecord[]> {
  return fetchJson(`/api/threads/${threadId}/timeline`);
}

export async function fetchThreadState(threadId: string): Promise<ThreadState> {
  return fetchJson(`/api/threads/${threadId}/state`);
}

export type MessageAttachment = { id: string; name: string; size: number; mediaType: string };

export async function uploadAttachment(threadId: string, file: File, signal?: AbortSignal): Promise<MessageAttachment> {
  return fetchJson(`/api/threads/${encodeURIComponent(threadId)}/attachments?name=${encodeURIComponent(file.name)}`, {
    method: "POST", headers: { "content-type": "application/octet-stream" }, body: file, signal,
  });
}

export async function downloadAttachment(threadId: string, attachment: MessageAttachment): Promise<void> {
  const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}/attachments/${encodeURIComponent(attachment.id)}`, withDeviceHeader());
  if (!response.ok) throw new Error("Could not download this file. Please try again.");
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = attachment.name;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export async function createRun(threadId: string, prompt: string, options: { fastMode?: boolean; attachmentIds?: string[] } = {}): Promise<RunRecord> {
  return fetchJson(`/api/threads/${threadId}/runs`, {
    body: JSON.stringify({ ...(options.fastMode ? { fastMode: true } : {}), ...(options.attachmentIds?.length ? { attachmentIds: options.attachmentIds } : {}), prompt }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export async function cancelRun(threadId: string): Promise<void> {
  await fetchJson(`/api/threads/${threadId}/runs/cancel`, {
    method: "POST",
  });
}

export async function sendRunInput(threadId: string, prompt: string, attachmentIds?: string[]): Promise<{ event: TimelineEventRecord | null; ok: true }> {
  return fetchJson(`/api/threads/${threadId}/runs/input`, {
    body: JSON.stringify({ prompt, ...(attachmentIds?.length ? { attachmentIds } : {}) }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export async function respondToApproval(
  threadId: string,
  approvalId: string,
  approved: boolean,
): Promise<void> {
  await fetchJson(`/api/threads/${threadId}/approval/${approvalId}`, {
    body: JSON.stringify({ approved }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export async function sendAgentInput(threadId: string, agentThreadId: string, prompt: string, attachmentIds?: string[]): Promise<{ ok: true; event: TimelineEventRecord | null }> {
  return fetchJson(`/api/threads/${encodeURIComponent(threadId)}/runs/agents/${encodeURIComponent(agentThreadId)}/input`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt, ...(attachmentIds?.length ? { attachmentIds } : {}) }),
  });
}

export async function respondToInput(
  threadId: string,
  inputRequestId: string,
  answers: Record<string, string[]>,
): Promise<void> {
  await fetchJson(`/api/threads/${threadId}/input/${inputRequestId}`, {
    body: JSON.stringify({ answers }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
}

export function connectTimeline(
  threadId: string,
  onEvent: (event: TimelineEventRecord) => void,
  options: TimelineConnectionOptions = {},
): () => void {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const params = new URLSearchParams({
    deviceId: readDeviceId(),
    threadId,
  });
  const socket = new WebSocket(`${protocol}//${window.location.host}/api/ws?${params.toString()}`);
  socket.addEventListener("message", (message) => {
    const parsed = JSON.parse(String(message.data)) as { event?: TimelineEventRecord; serverTime?: string; threadStatus?: ThreadStatus; type?: string };
    if (parsed.type === "timeline.event" && parsed.event) {
      onEvent(parsed.event);
    }
    if (parsed.type === "heartbeat") {
      options.onHeartbeat?.(typeof parsed.serverTime === "string" ? parsed.serverTime : "", parsed.threadStatus);
    }
  });
  socket.addEventListener("close", () => options.onDisconnect?.());
  socket.addEventListener("error", () => options.onDisconnect?.());
  return () => socket.close(1000, "Thread changed");
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, withDeviceHeader(init));
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: unknown };
    throw new Error(typeof body.error === "string" ? body.error : `Request failed: ${response.status}`);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

function withDeviceHeader(init: RequestInit = {}): RequestInit {
  const headers = new Headers(init.headers);
  headers.set(deviceIdHeaderName, readDeviceId());
  return { ...init, headers };
}

function readDeviceId(): string {
  const stored = window.localStorage.getItem(deviceIdStorageKey);
  if (stored && deviceIdPattern.test(stored)) {
    return stored;
  }

  const next = `pwa:${randomDeviceId()}`;
  window.localStorage.setItem(deviceIdStorageKey, next);
  return next;
}

function randomDeviceId(): string {
  if (window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  const random = new Uint8Array(16);
  window.crypto?.getRandomValues(random);
  if (random.some((value) => value !== 0)) {
    return Array.from(random, (value) => value.toString(16).padStart(2, "0")).join("");
  }
  return `${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
}

export type FileAsset = {
  id: string; name: string; title: string; description: string; size: number;
  mediaType: string; kind: 'text' | 'html' | 'pdf' | 'image' | 'video' | 'audio' | 'file';
  createdAt: string; sourceThreadId: string; sha256: string;
  searchStatus: 'content' | 'metadata' | 'partial'; searchNote: string | null;
  source?: { type: 'openwrite'; recordId: string; revision: number; status: 'active' | 'archived' | 'invalid'; statusReason: string; capturedAt: string };
};
export async function fetchFileAsset(id: string): Promise<FileAsset> {
  return fetchJson(`/api/assets/${encodeURIComponent(id)}`);
}
export async function fetchAssetAccess(id: string): Promise<{ url: string; expiresAt: string }> {
  return fetchJson(`/api/assets/${encodeURIComponent(id)}/access`, { method: 'POST' });
}
