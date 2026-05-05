export type ShortcutProtocol = "http" | "https";

export type AppShortcut = {
  id: string;
  name: string;
  protocol: ShortcutProtocol;
  host: string;
  port: number;
  path: string;
  url: string;
  createdAt: string;
  updatedAt: string;
};

export type AppShortcutInput = {
  name: string;
  protocol: ShortcutProtocol;
  host: string;
  port: number;
  path: string;
};

export type PreviewDependencyServiceInput = {
  name: string;
  url: string;
  browserDirect: boolean;
};

export type PreviewCommandInput = {
  label: string;
  cwd: string;
  command: string;
};

export type PreviewPublishedOriginInput = {
  name: string;
  url: string;
};

export type PreviewPublishedOriginStatus = "published" | "failed" | "unpublished";

export type PreviewPublishedOrigin = {
  id: string;
  source: "target" | "dependency-service";
  dependencyServiceName: string | null;
  dependencyServiceIndex: number | null;
  name: string;
  provider: "tailscale-serve";
  sourceUrl: string;
  publishedUrl: string | null;
  httpsPort: number;
  localProxyPort?: number | null;
  status: PreviewPublishedOriginStatus;
  error: string | null;
  createdAt: string;
  updatedAt: string;
};

export type WiredPreview = {
  id: string;
  name: string;
  wiringSessionId: string | null;
  projectDirectory: string;
  target: {
    name: string;
    url: string;
  };
  dependencyServices: PreviewDependencyServiceInput[];
  commands: PreviewCommandInput[];
  requestedPublishedOrigins: PreviewPublishedOriginInput[];
  publishedOrigins: PreviewPublishedOrigin[];
  createdAt: string;
  updatedAt: string;
};

export type WiredPreviewInput = {
  name: string;
  projectDirectory: string;
  target: {
    name: string;
    url: string;
  };
  dependencyServices: PreviewDependencyServiceInput[];
  commands: PreviewCommandInput[];
  requestedPublishedOrigins: PreviewPublishedOriginInput[];
};

export type PreviewManifestStatus = "pending" | "approved";

export type PreviewManifestInput = WiredPreviewInput & {
  wiredPreviewId?: string;
  wiringSessionId?: string;
};

export type PreviewManifest = {
  id: string;
  status: PreviewManifestStatus;
  wiredPreviewId: string | null;
  wiringSessionId: string | null;
  approvedWiredPreviewId: string | null;
  proposedName: string;
  projectDirectory: string;
  target: {
    name: string;
    url: string;
  };
  dependencyServices: PreviewDependencyServiceInput[];
  commands: PreviewCommandInput[];
  requestedPublishedOrigins: PreviewPublishedOriginInput[];
  materialHash: string;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
};

export type PreviewManifestApproval = {
  manifest: PreviewManifest;
  wiredPreview: WiredPreview;
};

export type PreviewWiringSessionLaunch = {
  session: OpenCozySessionSummary;
  prompt: string;
  reused: boolean;
  wiredPreview: WiredPreview | null;
};

export type OpenCozySessionMode = "new" | "resume" | "resumeLast";

export type OpenCozySessionSummary = {
  id: string;
  name: string;
  codexThreadId: string | null;
  wiredPreviewId: string | null;
  deviceId: string | null;
  mode: OpenCozySessionMode;
  command: string;
  args: string[];
  cwd: string;
  status: "running" | "exited";
  exitCode: number | null;
  createdAt: string;
  updatedAt: string;
};

export type CodexCapabilities = {
  installed: boolean;
  command: string;
  path: string | null;
  version: string | null;
  resumeListSupported: boolean;
  resumeListReason: string;
};

export type WanTunnelStatus = {
  config: {
    allowedHosts: string[];
    backendHost: string;
    backendLocalOnly: boolean;
    backendPort: number;
    frontendPort: number;
    serveTarget: string;
    tailscaleBin: string;
    tailscaleSocket: string | null;
  };
  tailscale: {
    backendState: string | null;
    cliAvailable: boolean;
    daemonReachable: boolean;
    dnsName: string | null;
    error: string | null;
    health: string[];
    httpsOrigin: string | null;
    ips: string[];
    nodeName: string | null;
    online: boolean | null;
    serveConfigured: boolean;
    serveStatus: string | null;
    tailnetSuffix: string | null;
    version: string | null;
  };
};
