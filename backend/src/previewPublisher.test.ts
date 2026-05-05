import { describe, expect, it } from "vitest";
import {
  allocatePreviewPublishPort,
  buildPreviewProxyTargetUrl,
  buildTailscaleServePublishArgs,
  buildTailscaleServeUnpublishArgs,
  TailscalePreviewPublisher,
  type PreviewPublisherCommandRunner
} from "./previewPublisher.js";
import type { WiredPreview } from "./types.js";

const basePreview: WiredPreview = {
  id: "preview-1",
  name: "Fixture App",
  wiringSessionId: null,
  projectDirectory: "/tmp/app",
  target: { name: "App", url: "http://127.0.0.1:5173/some/path" },
  dependencyServices: [],
  commands: [],
  requestedPublishedOrigins: [],
  publishedOrigins: [],
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString()
};
const config = {
  host: "127.0.0.1",
  port: 8788,
  dbPath: "/tmp/opencozy.sqlite",
  codexBin: "codex",
  defaultCodexCwd: "/tmp"
};

describe("Tailscale Preview Publisher", () => {
  it("constructs port-based Serve commands that keep the app at root", () => {
    expect(buildTailscaleServePublishArgs(8443, "http://127.0.0.1:5173/")).toEqual([
      "serve",
      "--bg",
      "--https=8443",
      "http://127.0.0.1:5173/"
    ]);
    expect(buildTailscaleServeUnpublishArgs(8443)).toEqual(["serve", "--https=8443", "off"]);
  });

  it("constructs backend preview proxy targets for Tailscale Serve", () => {
    expect(buildPreviewProxyTargetUrl(19000)).toBe("http://127.0.0.1:19000/");
  });

  it("publishes a target using the Tailscale DNS name and local proxy origin", async () => {
    const calls: string[][] = [];
    const runner: PreviewPublisherCommandRunner = async (args) => {
      calls.push(args);
      if (args[0] === "status") {
        return {
          ok: true,
          stdout: JSON.stringify({ Self: { DNSName: "jarvis.tailnet.test.", Online: true } }),
          stderr: ""
        };
      }

      return { ok: true, stdout: "", stderr: "" };
    };

    const publisher = new TailscalePreviewPublisher(config, runner);
    const result = await publisher.publishTarget({
      preview: basePreview,
      source: { type: "target" },
      httpsPort: 8443,
      localProxyPort: 19000
    });

    expect(result).toMatchObject({
      ok: true,
      origin: {
        source: "target",
        dependencyServiceName: null,
        dependencyServiceIndex: null,
        sourceUrl: "http://127.0.0.1:5173/",
        publishedUrl: "https://jarvis.tailnet.test:8443/",
        httpsPort: 8443,
        localProxyPort: 19000,
        status: "published",
        error: null
      }
    });
    expect(calls[0]).toEqual(["status", "--json"]);
    expect(calls[1][0]).toBe("serve");
    expect(calls[1][1]).toBe("--bg");
    expect(calls[1][2]).toBe("--https=8443");
    expect(calls[1][3]).toBe("http://127.0.0.1:19000/");
    expect(calls).not.toEqual([
      ["status", "--json"],
      ["serve", "--bg", "--https=8443", "http://127.0.0.1:5173/"]
    ]);
  });

  it("reports Tailscale failures without producing a published URL", async () => {
    const publisher = new TailscalePreviewPublisher(config, async () => ({
      ok: false,
      stdout: "",
      stderr: "not running",
      error: "not running"
    }));

    const result = await publisher.publishTarget({
      preview: basePreview,
      source: { type: "target" },
      httpsPort: 8443,
      localProxyPort: 19000
    });

    expect(result).toMatchObject({
      ok: false,
      origin: {
        publishedUrl: null,
        status: "failed",
        error: "not running"
      }
    });
  });

  it("publishes browser-direct dependency services as separate port-based origins", async () => {
    const calls: string[][] = [];
    const runner: PreviewPublisherCommandRunner = async (args) => {
      calls.push(args);
      if (args[0] === "status") {
        return {
          ok: true,
          stdout: JSON.stringify({ Self: { DNSName: "jarvis.tailnet.test.", Online: true } }),
          stderr: ""
        };
      }

      return { ok: true, stdout: "", stderr: "" };
    };

    const publisher = new TailscalePreviewPublisher(config, runner);
    const result = await publisher.publishTarget({
      preview: basePreview,
      source: {
        type: "dependency-service",
        service: { name: "API", url: "http://127.0.0.1:3000/api", browserDirect: true },
        serviceIndex: 0
      },
      httpsPort: 8444,
      localProxyPort: 19001
    });

    expect(result).toMatchObject({
      ok: true,
      origin: {
        source: "dependency-service",
        dependencyServiceName: "API",
        dependencyServiceIndex: 0,
        sourceUrl: "http://127.0.0.1:3000/",
        publishedUrl: "https://jarvis.tailnet.test:8444/",
        localProxyPort: 19001
      }
    });
    expect(calls[0]).toEqual(["status", "--json"]);
    expect(calls[1][0]).toBe("serve");
    expect(calls[1][1]).toBe("--bg");
    expect(calls[1][2]).toBe("--https=8444");
    expect(calls[1][3]).toBe("http://127.0.0.1:19001/");
    expect(calls).not.toEqual([
      ["status", "--json"],
      ["serve", "--bg", "--https=8444", "http://127.0.0.1:3000/"]
    ]);
  });


  it("allocates the first unused configured HTTPS port", () => {
    expect(allocatePreviewPublishPort([
      {
        ...basePreview,
        publishedOrigins: [
          {
            id: "origin-1",
            source: "target",
            dependencyServiceName: null,
            dependencyServiceIndex: null,
            name: "App",
            provider: "tailscale-serve",
            sourceUrl: "http://127.0.0.1:5173/",
            publishedUrl: "https://jarvis.tailnet.test:8443/",
            httpsPort: 8443,
            status: "published",
            error: null,
            createdAt: new Date(0).toISOString(),
            updatedAt: new Date(0).toISOString()
          }
        ]
      }
    ], { previewPublishPortStart: 8443, previewPublishPortEnd: 8444 })).toBe(8444);
  });
});
