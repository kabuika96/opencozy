import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { OpenCozyConfig } from "./config.js";
import type { PreviewDependencyServiceInput, PreviewPublishedOrigin, WiredPreview } from "./types.js";

type CommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  error?: string;
};

type TailscaleStatusJson = {
  Self?: {
    DNSName?: string;
    Online?: boolean;
  };
};

export type PreviewPublishInput = {
  preview: WiredPreview;
  source: PreviewPublishSource;
  httpsPort: number;
  localProxyPort: number;
  originId?: string;
};

export type PreviewPublishSource =
  | { type: "target" }
  | { type: "dependency-service"; service: PreviewDependencyServiceInput; serviceIndex: number };

export type PreviewPublishResult = {
  ok: boolean;
  origin: PreviewPublishedOrigin;
};

export type ResolvedPreviewPublishSource = {
  source: PreviewPublishedOrigin["source"];
  dependencyServiceName: string | null;
  dependencyServiceIndex: number | null;
  name: string;
  sourceUrl: string;
};

export type PreviewPublisherCommandRunner = (args: string[]) => Promise<CommandResult>;

function nowIso(): string {
  return new Date().toISOString();
}

function tailscaleArgs(config: OpenCozyConfig, args: string[]): string[] {
  return config.tailscaleSocket ? [`--socket=${config.tailscaleSocket}`, ...args] : args;
}

function defaultRunner(config: OpenCozyConfig): PreviewPublisherCommandRunner {
  return (args) => new Promise((resolve) => {
    execFile(config.tailscaleBin ?? "tailscale", tailscaleArgs(config, args), { timeout: 5_000 }, (error, stdout, stderr) => {
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

function normalizeDnsName(value: string | undefined): string | null {
  if (!value?.trim()) {
    return null;
  }

  return value.trim().replace(/\.$/, "");
}

function publishedUrl(dnsName: string, httpsPort: number): string {
  return httpsPort === 443 ? `https://${dnsName}/` : `https://${dnsName}:${httpsPort}/`;
}

function sourceOrigin(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host}/`;
}

export function resolvePreviewPublishSource(preview: WiredPreview, sourceInput: PreviewPublishSource): ResolvedPreviewPublishSource {
  if (sourceInput.type === "dependency-service") {
    return {
      source: "dependency-service",
      dependencyServiceName: sourceInput.service.name,
      dependencyServiceIndex: sourceInput.serviceIndex,
      name: sourceInput.service.name,
      sourceUrl: sourceOrigin(sourceInput.service.url)
    };
  }

  return {
    source: "target",
    dependencyServiceName: null,
    dependencyServiceIndex: null,
    name: preview.target.name,
    sourceUrl: sourceOrigin(preview.target.url)
  };
}

function failedOrigin(input: PreviewPublishInput, originId: string, error: string): PreviewPublishedOrigin {
  const timestamp = nowIso();
  const source = resolvePreviewPublishSource(input.preview, input.source);
  return {
    id: originId,
    source: source.source,
    dependencyServiceName: source.dependencyServiceName,
    dependencyServiceIndex: source.dependencyServiceIndex,
    name: source.name,
    provider: "tailscale-serve",
    sourceUrl: source.sourceUrl,
    publishedUrl: null,
    httpsPort: input.httpsPort,
    localProxyPort: input.localProxyPort,
    status: "failed",
    error,
    createdAt: timestamp,
    updatedAt: timestamp
  };
}

export function buildTailscaleServePublishArgs(httpsPort: number, targetUrl: string): string[] {
  return ["serve", "--bg", `--https=${httpsPort}`, targetUrl];
}

export function buildPreviewProxyTargetUrl(localProxyPort: number): string {
  return `http://127.0.0.1:${localProxyPort}/`;
}

export function buildTailscaleServeUnpublishArgs(httpsPort: number): string[] {
  return ["serve", `--https=${httpsPort}`, "off"];
}

export function allocatePreviewPublishPort(previews: WiredPreview[], config: OpenCozyConfig): number | null {
  const start = config.previewPublishPortStart ?? 8443;
  const end = config.previewPublishPortEnd ?? 8499;
  const usedPorts = new Set(
    previews.flatMap((preview) => preview.publishedOrigins)
      .filter((origin) => origin.status === "published")
      .map((origin) => origin.httpsPort)
  );

  for (let port = start; port <= end; port += 1) {
    if (!usedPorts.has(port)) {
      return port;
    }
  }

  return null;
}

export class TailscalePreviewPublisher {
  private readonly run: PreviewPublisherCommandRunner;

  constructor(private readonly config: OpenCozyConfig, runner?: PreviewPublisherCommandRunner) {
    this.run = runner ?? defaultRunner(config);
  }

  async publishTarget(input: PreviewPublishInput): Promise<PreviewPublishResult> {
    const originId = input.originId ?? randomUUID();
    const source = resolvePreviewPublishSource(input.preview, input.source);
    const targetUrl = source.sourceUrl;
    const status = await this.run(["status", "--json"]);
    if (!status.ok) {
      return {
        ok: false,
        origin: failedOrigin(input, originId, status.error ?? "Failed to read Tailscale status")
      };
    }

    let parsedStatus: TailscaleStatusJson;
    try {
      parsedStatus = JSON.parse(status.stdout) as TailscaleStatusJson;
    } catch {
      return {
        ok: false,
        origin: failedOrigin(input, originId, "Tailscale status did not return valid JSON")
      };
    }

    if (parsedStatus.Self?.Online === false) {
      return {
        ok: false,
        origin: failedOrigin(input, originId, "Tailscale node is offline")
      };
    }

    const dnsName = normalizeDnsName(parsedStatus.Self?.DNSName);
    if (!dnsName) {
      return {
        ok: false,
        origin: failedOrigin(input, originId, "Tailscale DNS name is unavailable; HTTPS Serve cannot publish a private origin")
      };
    }

    const serve = await this.run(buildTailscaleServePublishArgs(input.httpsPort, buildPreviewProxyTargetUrl(input.localProxyPort)));
    if (!serve.ok) {
      return {
        ok: false,
        origin: failedOrigin(input, originId, serve.error ?? "Tailscale Serve failed to publish the preview")
      };
    }

    const timestamp = nowIso();
    return {
      ok: true,
      origin: {
        id: originId,
        source: source.source,
        dependencyServiceName: source.dependencyServiceName,
        dependencyServiceIndex: source.dependencyServiceIndex,
        name: source.name,
        provider: "tailscale-serve",
        sourceUrl: targetUrl,
        publishedUrl: publishedUrl(dnsName, input.httpsPort),
        httpsPort: input.httpsPort,
        localProxyPort: input.localProxyPort,
        status: "published",
        error: null,
        createdAt: timestamp,
        updatedAt: timestamp
      }
    };
  }

  async unpublish(origin: PreviewPublishedOrigin): Promise<CommandResult> {
    return this.run(buildTailscaleServeUnpublishArgs(origin.httpsPort));
  }

  async publishProxyTarget(origin: PreviewPublishedOrigin): Promise<CommandResult> {
    if (!origin.localProxyPort) {
      return {
        ok: false,
        stdout: "",
        stderr: "",
        error: "Preview Published Origin is missing a local proxy port"
      };
    }

    return this.run(buildTailscaleServePublishArgs(origin.httpsPort, buildPreviewProxyTargetUrl(origin.localProxyPort)));
  }
}
