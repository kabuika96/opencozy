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

export type WorkspaceRecord = {
  path: string;
  updatedAt: string;
};

export type WorkspaceDiscovery = {
  explanation: string;
  title: string;
  workspacePath: string;
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

export type ThreadCompactionResponse = {
  compactedEventCount: number;
  estimatedTokens: number;
  event: TimelineEventRecord | null;
  skippedReason: string | null;
  thread: ThreadRecord;
};

export type CreateThreadInput = {
  fastMode?: boolean;
  harnessType: HarnessType;
  profileId?: string;
  title?: string;
  workspacePath: string;
};

export type CreateRunInput = {
  fastMode?: boolean;
  prompt: string;
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

export type PreviewWiringThreadLaunch = {
  prompt: string;
  reused: boolean;
  run: RunRecord;
  thread: ThreadRecord;
  wiredPreview: WiredPreview | null;
};
