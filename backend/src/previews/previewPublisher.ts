import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { PreviewRuntimeConfig } from "./previewConfig.js";
import type { PreviewDependencyServiceInput, PreviewPublishedOrigin, WiredPreview } from "../types.js";

type CommandResult = {
  error?: string;
  ok: boolean;
  stderr: string;
  stdout: string;
};

type TailscaleStatusJson = {
  Self?: {
    DNSName?: string;
    Online?: boolean;
  };
};

export type PreviewPublishSource =
  | { type: "target" }
  | { service: PreviewDependencyServiceInput; serviceIndex: number; type: "dependency-service" };

export type PreviewPublishInput = {
  httpsPort: number;
  localProxyPort: number;
  originId?: string;
  preview: WiredPreview;
  source: PreviewPublishSource;
};

export type PreviewPublishResult = {
  ok: boolean;
  origin: PreviewPublishedOrigin;
};

export type ResolvedPreviewPublishSource = {
  dependencyServiceIndex: number | null;
  dependencyServiceName: string | null;
  name: string;
  source: PreviewPublishedOrigin["source"];
  sourceUrl: string;
};

export type PreviewPublisherCommandRunner = (args: string[]) => Promise<CommandResult>;

function nowIso(): string {
  return new Date().toISOString();
}

function tailscaleArgs(config: PreviewRuntimeConfig, args: string[]): string[] {
  return config.tailscaleSocket ? [`--socket=${config.tailscaleSocket}`, ...args] : args;
}

function defaultRunner(config: PreviewRuntimeConfig): PreviewPublisherCommandRunner {
  return (args) => new Promise((resolve) => {
    execFile(config.tailscaleBin ?? "tailscale", tailscaleArgs(config, args), { timeout: 5_000 }, (error, stdout, stderr) => {
      const normalizedStdout = stdout.toString().trim();
      const normalizedStderr = stderr.toString().trim();
      if (error) {
        resolve({
          error: normalizedStderr || error.message,
          ok: false,
          stderr: normalizedStderr,
          stdout: normalizedStdout,
        });
        return;
      }

      resolve({
        ok: true,
        stderr: normalizedStderr,
        stdout: normalizedStdout,
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
      dependencyServiceIndex: sourceInput.serviceIndex,
      dependencyServiceName: sourceInput.service.name,
      name: sourceInput.service.name,
      source: "dependency-service",
      sourceUrl: sourceOrigin(sourceInput.service.url),
    };
  }

  return {
    dependencyServiceIndex: null,
    dependencyServiceName: null,
    name: preview.target.name,
    source: "target",
    sourceUrl: sourceOrigin(preview.target.url),
  };
}

function failedOrigin(input: PreviewPublishInput, originId: string, error: string): PreviewPublishedOrigin {
  const timestamp = nowIso();
  const source = resolvePreviewPublishSource(input.preview, input.source);
  return {
    createdAt: timestamp,
    dependencyServiceIndex: source.dependencyServiceIndex,
    dependencyServiceName: source.dependencyServiceName,
    error,
    httpsPort: input.httpsPort,
    id: originId,
    localProxyPort: input.localProxyPort,
    name: source.name,
    provider: "tailscale-serve",
    publishedUrl: null,
    source: source.source,
    sourceUrl: source.sourceUrl,
    status: "failed",
    updatedAt: timestamp,
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

export function allocatePreviewPublishPort(previews: WiredPreview[], config: PreviewRuntimeConfig): number | null {
  const start = config.previewPublishPortStart ?? 8443;
  const end = config.previewPublishPortEnd ?? 8499;
  const usedPorts = new Set(
    previews.flatMap((preview) => preview.publishedOrigins)
      .filter((origin) => origin.status === "published")
      .map((origin) => origin.httpsPort),
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

  constructor(private readonly config: PreviewRuntimeConfig, runner?: PreviewPublisherCommandRunner) {
    this.run = runner ?? defaultRunner(config);
  }

  async publishTarget(input: PreviewPublishInput): Promise<PreviewPublishResult> {
    const originId = input.originId ?? randomUUID();
    const source = resolvePreviewPublishSource(input.preview, input.source);
    const status = await this.run(["status", "--json"]);
    if (!status.ok) {
      return {
        ok: false,
        origin: failedOrigin(input, originId, status.error ?? "Failed to read Tailscale status"),
      };
    }

    let parsedStatus: TailscaleStatusJson;
    try {
      parsedStatus = JSON.parse(status.stdout) as TailscaleStatusJson;
    } catch {
      return {
        ok: false,
        origin: failedOrigin(input, originId, "Tailscale status did not return valid JSON"),
      };
    }

    if (parsedStatus.Self?.Online === false) {
      return {
        ok: false,
        origin: failedOrigin(input, originId, "Tailscale node is offline"),
      };
    }

    const dnsName = normalizeDnsName(parsedStatus.Self?.DNSName);
    if (!dnsName) {
      return {
        ok: false,
        origin: failedOrigin(input, originId, "Tailscale DNS name is unavailable; HTTPS Serve cannot publish a private origin"),
      };
    }

    const serve = await this.run(buildTailscaleServePublishArgs(input.httpsPort, buildPreviewProxyTargetUrl(input.localProxyPort)));
    if (!serve.ok) {
      return {
        ok: false,
        origin: failedOrigin(input, originId, serve.error ?? "Tailscale Serve failed to publish the preview"),
      };
    }

    const timestamp = nowIso();
    return {
      ok: true,
      origin: {
        createdAt: timestamp,
        dependencyServiceIndex: source.dependencyServiceIndex,
        dependencyServiceName: source.dependencyServiceName,
        error: null,
        httpsPort: input.httpsPort,
        id: originId,
        localProxyPort: input.localProxyPort,
        name: source.name,
        provider: "tailscale-serve",
        publishedUrl: publishedUrl(dnsName, input.httpsPort),
        source: source.source,
        sourceUrl: source.sourceUrl,
        status: "published",
        updatedAt: timestamp,
      },
    };
  }

  async publishProxyTarget(origin: PreviewPublishedOrigin): Promise<CommandResult> {
    if (!origin.localProxyPort) {
      return {
        error: "Preview Published Origin is missing a local proxy port",
        ok: false,
        stderr: "",
        stdout: "",
      };
    }

    return this.run(buildTailscaleServePublishArgs(origin.httpsPort, buildPreviewProxyTargetUrl(origin.localProxyPort)));
  }

  async unpublish(origin: PreviewPublishedOrigin): Promise<CommandResult> {
    return this.run(buildTailscaleServeUnpublishArgs(origin.httpsPort));
  }
}
