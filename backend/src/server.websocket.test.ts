import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer } from "./server.js";

const servers: Array<ReturnType<typeof buildServer>> = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(servers.map((server) => server.close()));
  servers.length = 0;
});

function makeTestCodexBin(body: string[] = ["process.stdout.write('fake codex ready\\n');", "process.stdin.resume();"]): { bin: string; cwd: string; dbPath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "opencozy-ws-"));
  const script = path.join(dir, "fake-codex.js");
  writeFileSync(
    script,
    [
      "#!/usr/bin/env node",
      ...body
    ].join("\n")
  );
  chmodSync(script, 0o755);

  return {
    bin: script,
    cwd: dir,
    dbPath: path.join(dir, "opencozy.sqlite")
  };
}

async function waitForSessionExit(server: ReturnType<typeof buildServer>, id: string): Promise<void> {
  const deadline = Date.now() + 1_000;

  while (Date.now() < deadline) {
    const listResponse = await server.inject({
      method: "GET",
      url: "/api/open-cozy-sessions"
    });
    const sessions = listResponse.json<Array<{ id: string; status: string }>>();
    if (sessions.some((session) => session.id === id && session.status === "exited")) {
      return;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error(`Session did not exit: ${id}`);
}

describe("OpenCozy session WebSocket route", () => {
  it("attaches to a created session and sends initial status", async () => {
    const fixture = makeTestCodexBin();
    const server = buildServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: fixture.dbPath,
      codexBin: fixture.bin,
      defaultCodexCwd: fixture.cwd
    });
    servers.push(server);

    await server.ready();

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/open-cozy-sessions",
      payload: {
        mode: "new",
        name: "Launch Plan",
        cwd: fixture.cwd
      }
    });
    expect(createResponse.statusCode).toBe(201);

    const session = createResponse.json<{ id: string; name: string }>();
    expect(session.name).toBe("Launch Plan");
    const statusMessage = new Promise<string>((resolve) => {
      void server.injectWS(`/api/open-cozy-sessions/${session.id}/socket`, {}, {
        onInit: (socket) => {
          socket.on("message", (data) => {
            const text = data.toString();
            const parsed = JSON.parse(text) as { type: string };
            if (parsed.type === "status") {
              resolve(text);
            }
          });
        }
      });
    });

    const message = await statusMessage;
    const parsed = JSON.parse(message) as { type: string; session?: { id: string; name: string } };

    expect(parsed.type).toBe("status");
    expect(parsed.session?.id).toBe(session.id);
    expect(parsed.session?.name).toBe("Launch Plan");

    await server.inject({
      method: "DELETE",
      url: `/api/open-cozy-sessions/${session.id}`
    });
  });

  it("replays a terminal exit to clients that attach after a fast failure", async () => {
    const fixture = makeTestCodexBin(["process.exit(7);"]);
    const server = buildServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: fixture.dbPath,
      codexBin: fixture.bin,
      defaultCodexCwd: fixture.cwd
    });
    servers.push(server);

    await server.ready();

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/open-cozy-sessions",
      payload: {
        mode: "new",
        cwd: fixture.cwd
      }
    });
    expect(createResponse.statusCode).toBe(201);

    const session = createResponse.json<{ id: string }>();
    await waitForSessionExit(server, session.id);

    const exitMessage = new Promise<{ type: string; exitCode: number }>((resolve) => {
      void server.injectWS(`/api/open-cozy-sessions/${session.id}/socket`, {}, {
        onInit: (socket) => {
          socket.on("message", (data) => {
            const parsed = JSON.parse(data.toString()) as { type: string; exitCode?: number };
            if (parsed.type === "exit" && typeof parsed.exitCode === "number") {
              resolve({ type: parsed.type, exitCode: parsed.exitCode });
            }
          });
        }
      });
    });

    await expect(exitMessage).resolves.toEqual({ type: "exit", exitCode: 7 });
  });

  it("starts Codex sessions with a color-capable terminal environment", async () => {
    vi.stubEnv("TERM", "dumb");
    vi.stubEnv("COLORTERM", "");
    vi.stubEnv("CLICOLOR", "0");
    vi.stubEnv("CLICOLOR_FORCE", "0");
    vi.stubEnv("CI", "1");
    vi.stubEnv("CODEX_CI", "1");

    const fixture = makeTestCodexBin([
      "process.stdout.write(JSON.stringify({",
      "  term: process.env.TERM ?? null,",
      "  colorTerm: process.env.COLORTERM ?? null,",
      "  forceColor: process.env.FORCE_COLOR ?? null,",
      "  cliColor: process.env.CLICOLOR ?? null,",
      "  cliColorForce: process.env.CLICOLOR_FORCE ?? null,",
      "  ci: process.env.CI ?? null,",
      "  codexCi: process.env.CODEX_CI ?? null",
      "}) + '\\n');",
      "process.stdin.resume();"
    ]);
    const server = buildServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: fixture.dbPath,
      codexBin: fixture.bin,
      defaultCodexCwd: fixture.cwd
    });
    servers.push(server);

    await server.ready();

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/open-cozy-sessions",
      payload: {
        mode: "new",
        cwd: fixture.cwd
      }
    });
    expect(createResponse.statusCode).toBe(201);

    const session = createResponse.json<{ id: string }>();
    const envMessage = new Promise<Record<string, string | null>>((resolve) => {
      let output = "";
      void server.injectWS(`/api/open-cozy-sessions/${session.id}/socket`, {}, {
        onInit: (socket) => {
          socket.on("message", (data) => {
            const parsed = JSON.parse(data.toString()) as { type: string; data?: string };
            if (parsed.type !== "output" || typeof parsed.data !== "string") {
              return;
            }

            output += parsed.data;
            try {
              resolve(JSON.parse(output.trim()) as Record<string, string | null>);
            } catch {
              return;
            }
          });
        }
      });
    });

    await expect(envMessage).resolves.toEqual({
      term: "xterm-256color",
      colorTerm: "truecolor",
      forceColor: "1",
      cliColor: "1",
      cliColorForce: "1",
      ci: null,
      codexCi: null
    });

    await server.inject({
      method: "DELETE",
      url: `/api/open-cozy-sessions/${session.id}`
    });
  });

  it("forwards WebSocket input to the Codex PTY", async () => {
    const fixture = makeTestCodexBin([
      "process.stdout.write('fake codex ready\\n');",
      "process.stdin.on('data', (chunk) => {",
      "  process.stdout.write(`received:${chunk.toString('utf8')}`);",
      "});",
      "process.stdin.resume();"
    ]);
    const server = buildServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: fixture.dbPath,
      codexBin: fixture.bin,
      defaultCodexCwd: fixture.cwd
    });
    servers.push(server);

    await server.ready();

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/open-cozy-sessions",
      payload: {
        mode: "new",
        cwd: fixture.cwd
      }
    });
    expect(createResponse.statusCode).toBe(201);

    const session = createResponse.json<{ id: string }>();
    const inputEcho = new Promise<string>((resolve) => {
      let output = "";
      let sentInput = false;
      void server.injectWS(`/api/open-cozy-sessions/${session.id}/socket`, {}, {
        onInit: (socket) => {
          socket.on("message", (data) => {
            const parsed = JSON.parse(data.toString()) as { type: string; data?: string };
            if (parsed.type !== "output" || typeof parsed.data !== "string") {
              return;
            }

            output += parsed.data;
            if (!sentInput && output.includes("fake codex ready")) {
              sentInput = true;
              socket.send(JSON.stringify({ type: "input", data: "hello\r" }));
            }
            if (output.includes("received:hello")) {
              resolve(output);
            }
          });
        }
      });
    });

    await expect(inputEcho).resolves.toContain("received:hello");

    await server.inject({
      method: "DELETE",
      url: `/api/open-cozy-sessions/${session.id}`
    });
  });
});
