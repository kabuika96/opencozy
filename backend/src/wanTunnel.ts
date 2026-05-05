import { execFile } from "node:child_process";
import type { OpenCozyConfig } from "./config.js";

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
};

type TailscaleStatusJson = {
  BackendState?: string;
  Health?: unknown[];
  MagicDNSSuffix?: string;
  Self?: {
    DNSName?: string;
    HostName?: string;
    Online?: boolean;
    TailscaleIPs?: string[];
  };
  TailscaleIPs?: string[];
  Version?: string;
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

function isLocalOnlyHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1" || normalized === "[::1]";
}

function normalizeDnsName(value: string | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }

  return value.trim().replace(/\.$/, "");
}

function readHealthMessages(value: unknown[] | undefined): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item;
      }
      if (item && typeof item === "object" && "Text" in item && typeof item.Text === "string") {
        return item.Text;
      }
      return null;
    })
    .filter((item): item is string => Boolean(item));
}

function tailscaleArgs(config: OpenCozyConfig, args: string[]): string[] {
  return config.tailscaleSocket ? [`--socket=${config.tailscaleSocket}`, ...args] : args;
}

function runTailscale(config: OpenCozyConfig, args: string[]): Promise<CommandResult> {
  return new Promise((resolve) => {
    execFile(config.tailscaleBin ?? "tailscale", tailscaleArgs(config, args), { timeout: 2_500 }, (error, stdout, stderr) => {
      const normalizedStdout = stdout.toString().trim();
      const normalizedStderr = stderr.toString().trim();
      if (error) {
        resolve({
          ok: false,
          stdout: normalizedStdout,
          stderr: normalizedStderr,
          error: normalizedStderr || error.message
        });
        return;
      }

      resolve({
        ok: true,
        stdout: normalizedStdout,
        stderr: normalizedStderr
      });
    });
  });
}

export async function readWanTunnelStatus(config: OpenCozyConfig): Promise<WanTunnelStatus> {
  const frontendPort = config.frontendPort ?? 5175;
  const serveTarget = `http://127.0.0.1:${frontendPort}`;
  const statusResult = await runTailscale(config, ["status", "--json"]);
  const serveResult = statusResult.ok ? await runTailscale(config, ["serve", "status"]) : null;
  let parsedStatus: TailscaleStatusJson | null = null;

  if (statusResult.ok) {
    try {
      parsedStatus = JSON.parse(statusResult.stdout) as TailscaleStatusJson;
    } catch {
      parsedStatus = null;
    }
  }

  const dnsName = normalizeDnsName(parsedStatus?.Self?.DNSName);
  const serveStatus = serveResult?.stdout || null;

  return {
    config: {
      allowedHosts: config.allowedHosts ?? [],
      backendHost: config.host,
      backendLocalOnly: isLocalOnlyHost(config.host),
      backendPort: config.port,
      frontendPort,
      serveTarget,
      tailscaleBin: config.tailscaleBin ?? "tailscale",
      tailscaleSocket: config.tailscaleSocket ?? null
    },
    tailscale: {
      backendState: parsedStatus?.BackendState ?? null,
      cliAvailable: statusResult.ok || !/ENOENT|not found/i.test(statusResult.error ?? ""),
      daemonReachable: statusResult.ok,
      dnsName,
      error: statusResult.ok ? null : statusResult.error ?? "Failed to read Tailscale status",
      health: readHealthMessages(parsedStatus?.Health),
      httpsOrigin: dnsName ? `https://${dnsName}` : null,
      ips: parsedStatus?.Self?.TailscaleIPs ?? parsedStatus?.TailscaleIPs ?? [],
      nodeName: parsedStatus?.Self?.HostName ?? null,
      online: parsedStatus?.Self?.Online ?? null,
      serveConfigured: Boolean(serveStatus && serveStatus !== "No serve config"),
      serveStatus,
      tailnetSuffix: parsedStatus?.MagicDNSSuffix ?? null,
      version: parsedStatus?.Version ?? null
    }
  };
}
