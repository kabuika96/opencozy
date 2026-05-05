import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type OutgoingHttpHeaders,
  type Server,
  type ServerResponse
} from "node:http";
import { request as httpsRequest } from "node:https";
import type { AddressInfo } from "node:net";
import type { Duplex } from "node:stream";
import type { OpenCozyConfig } from "./config.js";
import type { PreviewPublishedOrigin, WiredPreview } from "./types.js";

type ActivePreviewProxy = {
  origin: PreviewPublishedOrigin;
  server: Server;
};

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade"
]);

export class PreviewProxyPortUnavailableError extends Error {
  constructor(message = "No Preview Proxy ports are available") {
    super(message);
    this.name = "PreviewProxyPortUnavailableError";
  }
}

function isPortBindError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  return code === "EADDRINUSE" || code === "EACCES";
}

function buildTargetUrl(sourceUrl: string, requestUrl: string | undefined): URL {
  const target = new URL(sourceUrl);
  const request = new URL(requestUrl || "/", "http://opencozy.preview");
  const basePath = target.pathname.endsWith("/") ? target.pathname.slice(0, -1) : target.pathname;
  target.pathname = `${basePath}${request.pathname}`;
  target.search = request.search;
  return target;
}

function rewriteUrlPrefix(value: string | undefined, fromOrigin: string | null, toOrigin: string): string | undefined {
  if (!value || !fromOrigin || !value.startsWith(fromOrigin)) {
    return value;
  }

  return `${toOrigin}${value.slice(fromOrigin.length)}`;
}

function buildRequestHeaders(request: IncomingMessage, origin: PreviewPublishedOrigin, targetUrl: URL): Headers {
  const headers = new Headers();
  const sourceOrigin = new URL(origin.sourceUrl).origin;
  const publishedOrigin = origin.publishedUrl ? new URL(origin.publishedUrl).origin : null;

  for (const [name, value] of Object.entries(request.headers)) {
    const lowerName = name.toLowerCase();
    if (lowerName === "host" || HOP_BY_HOP_HEADERS.has(lowerName) || value === undefined) {
      continue;
    }

    if (lowerName === "origin" && typeof value === "string") {
      headers.set(name, rewriteUrlPrefix(value, publishedOrigin, sourceOrigin) ?? sourceOrigin);
      continue;
    }

    if (lowerName === "referer" && typeof value === "string") {
      headers.set(name, rewriteUrlPrefix(value, publishedOrigin, sourceOrigin) ?? value);
      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(name, item);
      }
    } else {
      headers.set(name, String(value));
    }
  }

  headers.set("x-forwarded-host", request.headers.host ?? "");
  headers.set("x-forwarded-proto", "https");
  headers.set("x-forwarded-preview-target", targetUrl.origin);
  return headers;
}

function buildUpgradeHeaders(request: IncomingMessage, origin: PreviewPublishedOrigin, targetUrl: URL): OutgoingHttpHeaders {
  const headers: OutgoingHttpHeaders = {};
  const sourceOrigin = new URL(origin.sourceUrl).origin;
  const publishedOrigin = origin.publishedUrl ? new URL(origin.publishedUrl).origin : null;

  for (const [name, value] of Object.entries(request.headers)) {
    const lowerName = name.toLowerCase();
    if (lowerName === "host" || HOP_BY_HOP_HEADERS.has(lowerName) || value === undefined) {
      continue;
    }

    if (lowerName === "origin" && typeof value === "string") {
      headers[name] = rewriteUrlPrefix(value, publishedOrigin, sourceOrigin) ?? sourceOrigin;
      continue;
    }

    if (lowerName === "referer" && typeof value === "string") {
      headers[name] = rewriteUrlPrefix(value, publishedOrigin, sourceOrigin) ?? value;
      continue;
    }

    headers[name] = value;
  }

  headers.host = targetUrl.host;
  headers.connection = "Upgrade";
  headers.upgrade = request.headers.upgrade ?? "websocket";
  headers["x-forwarded-host"] = request.headers.host ?? "";
  headers["x-forwarded-proto"] = "https";
  headers["x-forwarded-preview-target"] = targetUrl.origin;
  return headers;
}

function buildResponseHeaders(response: Response, origin: PreviewPublishedOrigin): Record<string, string> {
  const headers: Record<string, string> = {};
  const sourceOrigin = new URL(origin.sourceUrl).origin;
  const publishedOrigin = origin.publishedUrl ? new URL(origin.publishedUrl).origin : null;

  response.headers.forEach((value, name) => {
    const lowerName = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerName)) {
      return;
    }

    if (lowerName === "location" && publishedOrigin) {
      headers[name] = rewriteUrlPrefix(value, sourceOrigin, publishedOrigin) ?? value;
      return;
    }

    headers[name] = value;
  });

  return headers;
}

function writeRawResponseHead(socket: Duplex, statusCode: number | undefined, statusMessage: string | undefined, rawHeaders: string[]): void {
  socket.write(`HTTP/1.1 ${statusCode ?? 502} ${statusMessage || "Bad Gateway"}\r\n`);
  for (let index = 0; index < rawHeaders.length; index += 2) {
    socket.write(`${rawHeaders[index]}: ${rawHeaders[index + 1]}\r\n`);
  }
  socket.write("\r\n");
}

async function proxyRequest(origin: PreviewPublishedOrigin, request: IncomingMessage, response: ServerResponse): Promise<void> {
  const targetUrl = buildTargetUrl(origin.sourceUrl, request.url);
  const method = (request.method || "GET").toUpperCase();
  const fetchInit: RequestInit & { duplex?: "half" } = {
    headers: buildRequestHeaders(request, origin, targetUrl),
    method,
    redirect: "manual"
  };

  if (method !== "GET" && method !== "HEAD") {
    fetchInit.body = request as unknown as NonNullable<RequestInit["body"]>;
    fetchInit.duplex = "half";
  }

  try {
    const targetResponse = await fetch(targetUrl, fetchInit);
    const body = method === "HEAD" ? Buffer.alloc(0) : Buffer.from(await targetResponse.arrayBuffer());
    response.writeHead(targetResponse.status, buildResponseHeaders(targetResponse, origin));
    response.end(body);
  } catch {
    response.writeHead(502, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: "Preview target did not respond" }));
  }
}

function proxyUpgrade(origin: PreviewPublishedOrigin, request: IncomingMessage, socket: Duplex, head: Buffer): void {
  const targetUrl = buildTargetUrl(origin.sourceUrl, request.url);
  const requestFn = targetUrl.protocol === "https:" ? httpsRequest : httpRequest;
  const upstream = requestFn({
    protocol: targetUrl.protocol,
    hostname: targetUrl.hostname,
    port: targetUrl.port || (targetUrl.protocol === "https:" ? 443 : 80),
    path: `${targetUrl.pathname}${targetUrl.search}`,
    method: request.method,
    headers: buildUpgradeHeaders(request, origin, targetUrl)
  });

  upstream.on("upgrade", (upstreamResponse, upstreamSocket, upstreamHead) => {
    writeRawResponseHead(socket, upstreamResponse.statusCode, upstreamResponse.statusMessage, upstreamResponse.rawHeaders);
    if (upstreamHead.length > 0) {
      socket.write(upstreamHead);
    }
    if (head.length > 0) {
      upstreamSocket.write(head);
    }
    upstreamSocket.pipe(socket);
    socket.pipe(upstreamSocket);
  });

  upstream.on("response", (upstreamResponse) => {
    writeRawResponseHead(socket, upstreamResponse.statusCode, upstreamResponse.statusMessage, upstreamResponse.rawHeaders);
    upstreamResponse.pipe(socket);
  });

  upstream.on("error", () => {
    if (!socket.destroyed) {
      socket.end("HTTP/1.1 502 Bad Gateway\r\ncontent-length: 0\r\n\r\n");
    }
  });

  upstream.end();
}

function listen(server: Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      const address = server.address() as AddressInfo | null;
      resolve(address?.port ?? port);
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, "127.0.0.1");
  });
}

function close(server: Server): Promise<void> {
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

function candidatePorts(start: number, end: number, preferredPort: number | null | undefined): number[] {
  const ports: number[] = [];
  if (preferredPort !== undefined && preferredPort !== null) {
    ports.push(preferredPort);
  }

  if (start === 0 && end === 0) {
    ports.push(0);
    return Array.from(new Set(ports));
  }

  for (let port = start; port <= end; port += 1) {
    ports.push(port);
  }

  return Array.from(new Set(ports));
}

export class PreviewProxyManager {
  private readonly active = new Map<string, ActivePreviewProxy>();
  private readonly portStart: number;
  private readonly portEnd: number;

  constructor(config: Pick<OpenCozyConfig, "previewProxyPortStart" | "previewProxyPortEnd"> = {}) {
    this.portStart = config.previewProxyPortStart ?? 19000;
    this.portEnd = config.previewProxyPortEnd ?? 19999;
  }

  async ensure(origin: PreviewPublishedOrigin): Promise<PreviewPublishedOrigin> {
    if (origin.status !== "published") {
      return origin;
    }

    const current = this.active.get(origin.id);
    if (current && current.origin.localProxyPort === origin.localProxyPort && current.origin.sourceUrl === origin.sourceUrl) {
      current.origin = origin;
      return origin;
    }

    if (current) {
      await this.close(origin.id);
    }

    for (const port of candidatePorts(this.portStart, this.portEnd, origin.localProxyPort)) {
      if (port !== 0 && Array.from(this.active.values()).some((active) => active.origin.localProxyPort === port)) {
        continue;
      }

      const server = createServer((request, response) => {
        const active = this.active.get(origin.id);
        void proxyRequest(active?.origin ?? origin, request, response);
      });
      server.on("upgrade", (request, socket, head) => {
        const active = this.active.get(origin.id);
        proxyUpgrade(active?.origin ?? origin, request, socket, head);
      });

      try {
        const boundPort = await listen(server, port);
        const ensuredOrigin = {
          ...origin,
          localProxyPort: boundPort
        };
        this.active.set(origin.id, {
          origin: ensuredOrigin,
          server
        });
        return ensuredOrigin;
      } catch (error) {
        if (isPortBindError(error)) {
          server.close();
          continue;
        }

        throw error;
      }
    }

    throw new PreviewProxyPortUnavailableError();
  }

  async sync(previews: WiredPreview[]): Promise<PreviewPublishedOrigin[]> {
    const ensured: PreviewPublishedOrigin[] = [];
    for (const preview of previews) {
      for (const origin of preview.publishedOrigins) {
        if (origin.status === "published") {
          ensured.push(await this.ensure(origin));
        }
      }
    }
    return ensured;
  }

  async close(originId: string): Promise<void> {
    const current = this.active.get(originId);
    if (!current) {
      return;
    }

    this.active.delete(originId);
    await close(current.server);
  }

  async closeOrigins(origins: PreviewPublishedOrigin[]): Promise<void> {
    await Promise.all(origins.map((origin) => this.close(origin.id)));
  }

  async closeAll(): Promise<void> {
    await Promise.all(Array.from(this.active.keys()).map((originId) => this.close(originId)));
  }
}
