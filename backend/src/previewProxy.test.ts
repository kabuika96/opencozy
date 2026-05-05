import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { PreviewProxyManager } from "./previewProxy.js";
import type { PreviewPublishedOrigin } from "./types.js";

function listen(server: ReturnType<typeof createServer>, port = 0): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Server did not bind to a TCP port"));
        return;
      }
      resolve(address.port);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

function originFixture(input: Partial<PreviewPublishedOrigin>): PreviewPublishedOrigin {
  return {
    id: "origin-1",
    source: "target",
    dependencyServiceName: null,
    dependencyServiceIndex: null,
    name: "App",
    provider: "tailscale-serve",
    sourceUrl: "http://127.0.0.1:5173/",
    publishedUrl: "https://jarvis.tailnet.test:8443/",
    httpsPort: 8443,
    localProxyPort: null,
    status: "published",
    error: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...input
  };
}

describe("PreviewProxyManager", () => {
  it("proxies root-mounted preview requests using the target Host header", async () => {
    const targetServer = createServer((request, response) => {
      const targetAddress = targetServer.address();
      if (!targetAddress || typeof targetAddress === "string") {
        response.writeHead(500);
        response.end("missing target address");
        return;
      }

      expect(request.headers.host).toBe(`127.0.0.1:${targetAddress.port}`);
      response.setHeader("location", `http://127.0.0.1:${targetAddress.port}/redirected`);
      response.end(`ok ${request.url}`);
    });
    const targetPort = await listen(targetServer);
    const manager = new PreviewProxyManager({ previewProxyPortStart: 0, previewProxyPortEnd: 0 });

    try {
      const origin = await manager.ensure(originFixture({
        sourceUrl: `http://127.0.0.1:${targetPort}/`
      }));
      expect(origin.localProxyPort).toEqual(expect.any(Number));

      const response = await fetch(`http://127.0.0.1:${origin.localProxyPort}/@vite/client?x=1`, {
        redirect: "manual",
        headers: {
          origin: "https://jarvis.tailnet.test:8443"
        }
      });

      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBe("https://jarvis.tailnet.test:8443/redirected");
      expect(await response.text()).toBe("ok /@vite/client?x=1");
    } finally {
      await manager.closeAll();
      await close(targetServer);
    }
  });

  it("reassigns the local proxy port when the planned port is already occupied", async () => {
    const blocker = createServer((_request, response) => {
      response.end("occupied");
    });
    const blockedPort = await listen(blocker);
    const manager = new PreviewProxyManager({ previewProxyPortStart: 0, previewProxyPortEnd: 0 });

    try {
      const origin = await manager.ensure(originFixture({
        localProxyPort: blockedPort
      }));

      expect(origin.localProxyPort).not.toBe(blockedPort);
      expect(origin.localProxyPort).toEqual(expect.any(Number));
    } finally {
      await manager.closeAll();
      await close(blocker);
    }
  });
});
