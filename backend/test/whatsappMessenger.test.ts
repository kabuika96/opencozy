import { createServer, type IncomingMessage } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { createHermesWhatsAppMessenger } from "../src/messaging/whatsappMessenger.js";

const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  })));
});

describe("Hermes WhatsApp messenger", () => {
  it("sends to its configured owner chat through the connected loopback bridge", async () => {
    const requests: Array<{ body: unknown; method: string; url: string }> = [];
    const server = createServer(async (request, response) => {
      if (request.method === "GET" && request.url === "/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "connected" }));
        return;
      }
      requests.push({
        body: JSON.parse(await requestBody(request)),
        method: request.method ?? "",
        url: request.url ?? "",
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ messageId: "wamid-1" }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test bridge did not bind a TCP port");
    }

    const messenger = createHermesWhatsAppMessenger({
      bridgePort: address.port,
      chatId: "owner@lid",
    });

    await expect(messenger.sendMessage("Build finished.")).resolves.toEqual({
      messageId: "wamid-1",
    });
    expect(requests).toEqual([{
      body: {
        chatId: "owner@lid",
        message: "Build finished.",
      },
      method: "POST",
      url: "/send",
    }]);
  });

  it("explains how to recover when the Hermes bridge is disconnected", async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ status: "disconnected" }));
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test bridge did not bind a TCP port");
    }

    const messenger = createHermesWhatsAppMessenger({
      bridgePort: address.port,
      chatId: "owner@lid",
    });

    await expect(messenger.sendMessage("Build finished.")).rejects.toThrow(
      'Hermes WhatsApp bridge is offline (status: disconnected). Run "hermes whatsapp" to pair or reconnect it.',
    );
  });

  it("returns the Hermes bridge reason when WhatsApp rejects a send", async () => {
    const server = createServer((request, response) => {
      if (request.method === "GET" && request.url === "/health") {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ status: "connected" }));
        return;
      }
      response.writeHead(503, { "content-type": "text/plain" });
      response.end("not connected");
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test bridge did not bind a TCP port");
    }

    const messenger = createHermesWhatsAppMessenger({
      bridgePort: address.port,
      chatId: "owner@lid",
    });

    await expect(messenger.sendMessage("Build finished.")).rejects.toThrow(
      "WhatsApp send failed (503): not connected",
    );
  });
});

async function requestBody(request: IncomingMessage): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}
