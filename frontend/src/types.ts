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

export type OpenCozySessionMode = "new" | "resume" | "resumeLast";

export type OpenCozySessionSummary = {
  id: string;
  name: string;
  codexThreadId: string | null;
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
