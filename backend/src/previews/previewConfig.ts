export type PreviewRuntimeConfig = {
  backendPort: number;
  previewProxyPortEnd?: number;
  previewProxyPortStart?: number;
  previewPublishPortEnd?: number;
  previewPublishPortStart?: number;
  tailscaleBin?: string;
  tailscaleSocket?: string;
};

function readPort(name: string, fallback: string): number {
  const value = process.env[name] ?? fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${name} must be an integer from 1 to 65535`);
  }
  return parsed;
}

export function readPreviewRuntimeConfig(): PreviewRuntimeConfig {
  const previewPublishPortStart = readPort("LITEHARNESS_PREVIEW_PUBLISH_PORT_START", "8443");
  const previewPublishPortEnd = readPort("LITEHARNESS_PREVIEW_PUBLISH_PORT_END", "8499");
  if (previewPublishPortStart > previewPublishPortEnd) {
    throw new Error("LITEHARNESS_PREVIEW_PUBLISH_PORT_START must be less than or equal to LITEHARNESS_PREVIEW_PUBLISH_PORT_END");
  }

  const previewProxyPortStart = readPort("LITEHARNESS_PREVIEW_PROXY_PORT_START", "19000");
  const previewProxyPortEnd = readPort("LITEHARNESS_PREVIEW_PROXY_PORT_END", "19999");
  if (previewProxyPortStart > previewProxyPortEnd) {
    throw new Error("LITEHARNESS_PREVIEW_PROXY_PORT_START must be less than or equal to LITEHARNESS_PREVIEW_PROXY_PORT_END");
  }

  return {
    backendPort: readPort("LITEHARNESS_BACKEND_PORT", "8787"),
    previewProxyPortEnd,
    previewProxyPortStart,
    previewPublishPortEnd,
    previewPublishPortStart,
    tailscaleBin: process.env.LITEHARNESS_TAILSCALE_BIN?.trim() || "tailscale",
    tailscaleSocket: process.env.LITEHARNESS_TAILSCALE_SOCKET?.trim() || undefined,
  };
}
