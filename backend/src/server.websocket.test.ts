import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildServer, shouldReplaySessionHistory } from "./server.js";

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

function createCodexStateDb(dir: string): string {
  const dbPath = path.join(dir, "state_5.sqlite");
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE threads (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      cwd TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      archived INTEGER NOT NULL DEFAULT 0,
      first_user_message TEXT NOT NULL DEFAULT '',
      rollout_path TEXT NOT NULL DEFAULT '',
      created_at_ms INTEGER,
      updated_at_ms INTEGER
    );
  `);
  db.close();
  return dbPath;
}

function insertCodexThread(dbPath: string, input: { id: string; title: string; cwd: string; updatedAtMs: number; firstUserMessage?: string; rolloutPath?: string }): void {
  const db = new DatabaseSync(dbPath);
  db
    .prepare("INSERT INTO threads (id, title, cwd, first_user_message, rollout_path, created_at, updated_at, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(input.id, input.title, input.cwd, input.firstUserMessage || "", input.rolloutPath || "", 1, 1, input.updatedAtMs, input.updatedAtMs);
  db.close();
}

function writeCodexRollout(dir: string, fileName: string, userMessage: string): string {
  const rolloutPath = path.join(dir, fileName);
  writeFileSync(
    rolloutPath,
    `${JSON.stringify({
      type: "event_msg",
      payload: {
        type: "user_message",
        message: userMessage
      }
    })}\n`
  );
  return rolloutPath;
}

async function waitForSessionExit(server: ReturnType<typeof buildServer>, id: string, deviceId: string): Promise<void> {
  const deadline = Date.now() + 1_000;

  while (Date.now() < deadline) {
    const listResponse = await server.inject({
      method: "GET",
      url: `/api/open-cozy-sessions?deviceId=${deviceId}`
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
  it("replays history by default and allows same-page reconnects to opt out", () => {
    expect(shouldReplaySessionHistory("/api/open-cozy-sessions/session-1/socket")).toBe(true);
    expect(shouldReplaySessionHistory("/api/open-cozy-sessions/session-1/socket?replay=0")).toBe(false);
    expect(shouldReplaySessionHistory("/api/open-cozy-sessions/session-1/socket?replay=false")).toBe(false);
  });

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

  it("lists only sessions for the requested device", async () => {
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

    const unscopedListResponse = await server.inject({
      method: "GET",
      url: "/api/open-cozy-sessions"
    });
    expect(unscopedListResponse.statusCode).toBe(400);

    const createSession = async (name: string, deviceId?: string) => {
      const response = await server.inject({
        method: "POST",
        url: "/api/open-cozy-sessions",
        payload: {
          mode: "new",
          name,
          cwd: fixture.cwd,
          ...(deviceId ? { deviceId } : {})
        }
      });
      expect(response.statusCode).toBe(201);
      return response.json<{ id: string; name: string }>();
    };

    const deviceOneSession = await createSession("Device One", "device-1");
    const deviceTwoSession = await createSession("Device Two", "device-2");
    await createSession("Unscoped Session");

    const listResponse = await server.inject({
      method: "GET",
      url: "/api/open-cozy-sessions?deviceId=device-1"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json<Array<{ id: string; name: string }>>()).toEqual([
      expect.objectContaining({
        id: deviceOneSession.id,
        name: "Device One"
      })
    ]);

    const explicitTabListResponse = await server.inject({
      method: "GET",
      url: `/api/open-cozy-sessions?deviceId=device-1&tabId=${deviceTwoSession.id}`
    });
    expect(explicitTabListResponse.statusCode).toBe(200);
    expect(explicitTabListResponse.json<Array<{ id: string; name: string }>>()).toEqual([
      expect.objectContaining({
        id: deviceTwoSession.id,
        name: "Device Two"
      }),
      expect.objectContaining({
        id: deviceOneSession.id,
        name: "Device One"
      })
    ]);
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
        cwd: fixture.cwd,
        deviceId: "device-1"
      }
    });
    expect(createResponse.statusCode).toBe(201);

    const session = createResponse.json<{ id: string }>();
    await waitForSessionExit(server, session.id, "device-1");

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

  it("renames the OpenCozy session and the matching Codex resume title", async () => {
    const fixture = makeTestCodexBin();
    const codexStateDbPath = createCodexStateDb(fixture.cwd);
    insertCodexThread(codexStateDbPath, {
      id: "thread-1",
      title: "Old Codex Title",
      cwd: fixture.cwd,
      updatedAtMs: Date.now()
    });
    const server = buildServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: fixture.dbPath,
      codexBin: fixture.bin,
      defaultCodexCwd: fixture.cwd,
      codexStateDbPath
    });
    servers.push(server);

    await server.ready();

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/open-cozy-sessions",
      payload: {
        mode: "resumeLast",
        cwd: fixture.cwd,
        codexThreadId: "thread-1",
        deviceId: "device-1"
      }
    });
    expect(createResponse.statusCode).toBe(201);
    const session = createResponse.json<{ id: string; name: string }>();

    const renameResponse = await server.inject({
      method: "PUT",
      url: `/api/open-cozy-sessions/${session.id}`,
      payload: {
        name: "Release Checklist"
      }
    });

    expect(renameResponse.statusCode).toBe(200);
    expect(renameResponse.json<{ name: string; codexThreadId: string | null }>()).toMatchObject({
      name: "Release Checklist",
      codexThreadId: "thread-1"
    });
    const verifyDb = new DatabaseSync(codexStateDbPath);
    expect(verifyDb.prepare("SELECT title FROM threads WHERE id = ?").get("thread-1")).toEqual({ title: "Release Checklist" });
    verifyDb.close();

    await server.inject({
      method: "DELETE",
      url: `/api/open-cozy-sessions/${session.id}`
    });
  });

  it("updates a new session title from the matching Codex first user message", async () => {
    const fixture = makeTestCodexBin(["process.stdout.write('new session ready\\n');", "process.stdin.resume();"]);
    const codexStateDbPath = createCodexStateDb(fixture.cwd);
    const server = buildServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: fixture.dbPath,
      codexBin: fixture.bin,
      defaultCodexCwd: fixture.cwd,
      codexStateDbPath
    });
    servers.push(server);

    await server.ready();

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/open-cozy-sessions",
      payload: {
        mode: "new",
        cwd: fixture.cwd,
        deviceId: "device-1"
      }
    });
    expect(createResponse.statusCode).toBe(201);
    const session = createResponse.json<{ id: string; name: string; codexThreadId: string | null; createdAt: string }>();
    expect(session).toMatchObject({ name: "Codex", codexThreadId: null });

    insertCodexThread(codexStateDbPath, {
      id: "new-thread",
      title: "Build Settings Flow",
      cwd: fixture.cwd,
      updatedAtMs: Date.parse(session.createdAt) + 1_000,
      firstUserMessage: "build settings flow"
    });

    const updatedTitle = new Promise<{ name: string; codexThreadId: string | null }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("New session title did not update from Codex metadata")), 3_000);
      let submittedPrompt = false;

      void server.injectWS(`/api/open-cozy-sessions/${session.id}/socket`, {}, {
        onInit: (socket) => {
          socket.on("message", (data) => {
            const parsed = JSON.parse(data.toString()) as {
              type: string;
              data?: string;
              session?: { name: string; codexThreadId: string | null };
            };

            if (parsed.type === "output" && parsed.data?.includes("new session ready") && !submittedPrompt) {
              submittedPrompt = true;
              socket.send(JSON.stringify({ type: "input", data: "build settings flow\r" }));
            }

            if (parsed.type === "status" && parsed.session?.name === "Build Settings Flow") {
              clearTimeout(timeout);
              resolve(parsed.session);
            }
          });
        }
      });
    });

    await expect(updatedTitle).resolves.toMatchObject({
      name: "Build Settings Flow",
      codexThreadId: "new-thread"
    });

    await server.inject({
      method: "DELETE",
      url: `/api/open-cozy-sessions/${session.id}`
    });
  });

  it("does not attach a new OpenCozy session to an unrelated active Codex thread title", async () => {
    const fixture = makeTestCodexBin();
    const codexStateDbPath = createCodexStateDb(fixture.cwd);
    const server = buildServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: fixture.dbPath,
      codexBin: fixture.bin,
      defaultCodexCwd: fixture.cwd,
      codexStateDbPath
    });
    servers.push(server);

    await server.ready();

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/open-cozy-sessions",
      payload: {
        mode: "new",
        cwd: fixture.cwd,
        codexThreadId: "other-device-thread",
        deviceId: "device-2"
      }
    });
    expect(createResponse.statusCode).toBe(201);
    const session = createResponse.json<{ id: string; name: string; codexThreadId: string | null; deviceId: string | null }>();
    expect(session).toMatchObject({ name: "Codex", codexThreadId: null, deviceId: "device-2" });

    insertCodexThread(codexStateDbPath, {
      id: "other-device-thread",
      title: "Other Device Session",
      cwd: fixture.cwd,
      updatedAtMs: Date.now() + 10_000,
      firstUserMessage: "other device prompt"
    });

    const submittedPrompt = new Promise<void>((resolve) => {
      void server.injectWS(`/api/open-cozy-sessions/${session.id}/socket`, {}, {
        onInit: (socket) => {
          socket.on("message", (data) => {
            const parsed = JSON.parse(data.toString()) as { type: string; data?: string };
            if (parsed.type === "output" && parsed.data?.includes("fake codex ready")) {
              socket.send(JSON.stringify({ type: "input", data: "phone prompt\r" }));
              resolve();
            }
          });
        }
      });
    });
    await submittedPrompt;
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    const listResponse = await server.inject({
      method: "GET",
      url: "/api/open-cozy-sessions?deviceId=device-2"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json<Array<{ id: string; name: string; codexThreadId: string | null }>>()).toContainEqual(
      expect.objectContaining({
        id: session.id,
        name: "Codex",
        codexThreadId: null
      })
    );

    await server.inject({
      method: "DELETE",
      url: `/api/open-cozy-sessions/${session.id}`
    });
  });

  it("does not use global Codex --last for resume-last sessions without a device-scoped thread", async () => {
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
        mode: "resumeLast",
        cwd: fixture.cwd
      }
    });
    expect(createResponse.statusCode).toBe(201);
    const session = createResponse.json<{ id: string; args: string[] }>();
    expect(session.args).not.toContain("--last");
    expect(session.args).toEqual(expect.arrayContaining(["resume", "-C", fixture.cwd]));

    await server.inject({
      method: "DELETE",
      url: `/api/open-cozy-sessions/${session.id}`
    });
  });

  it("uses the device-scoped Codex thread id for resume-last sessions when provided", async () => {
    const fixture = makeTestCodexBin();
    const codexStateDbPath = createCodexStateDb(fixture.cwd);
    insertCodexThread(codexStateDbPath, {
      id: "device-thread",
      title: "Device Session",
      cwd: fixture.cwd,
      updatedAtMs: Date.now()
    });
    const server = buildServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: fixture.dbPath,
      codexBin: fixture.bin,
      defaultCodexCwd: fixture.cwd,
      codexStateDbPath
    });
    servers.push(server);

    await server.ready();

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/open-cozy-sessions",
      payload: {
        mode: "resumeLast",
        cwd: fixture.cwd,
        codexThreadId: "device-thread",
        deviceId: "device-1"
      }
    });
    expect(createResponse.statusCode).toBe(201);
    const session = createResponse.json<{ id: string; args: string[]; codexThreadId: string | null; deviceId: string | null; name: string }>();
    expect(session.args).not.toContain("--last");
    expect(session.args).toEqual(expect.arrayContaining(["resume", "device-thread", "-C", fixture.cwd]));
    expect(session).toMatchObject({
      codexThreadId: "device-thread",
      deviceId: "device-1",
      name: "Device Session"
    });

    await server.inject({
      method: "DELETE",
      url: `/api/open-cozy-sessions/${session.id}`
    });
  });

  it("does not title a resume picker session from another device's newer Codex thread", async () => {
    const fixture = makeTestCodexBin(["process.stdout.write('resume picker ready\\n');", "process.stdin.resume();"]);
    const codexStateDbPath = createCodexStateDb(fixture.cwd);
    const server = buildServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: fixture.dbPath,
      codexBin: fixture.bin,
      defaultCodexCwd: fixture.cwd,
      codexStateDbPath
    });
    servers.push(server);

    await server.ready();

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/open-cozy-sessions",
      payload: {
        mode: "resume",
        cwd: fixture.cwd,
        deviceId: "device-1"
      }
    });
    expect(createResponse.statusCode).toBe(201);
    const session = createResponse.json<{ id: string; name: string; codexThreadId: string | null }>();
    expect(session).toMatchObject({ name: "Sessions", codexThreadId: null });

    const sawResumePicker = new Promise<void>((resolve) => {
      void server.injectWS(`/api/open-cozy-sessions/${session.id}/socket`, {}, {
        onInit: (socket) => {
          socket.on("message", (data) => {
            const parsed = JSON.parse(data.toString()) as { type: string; data?: string };
            if (parsed.type === "output" && parsed.data?.includes("resume picker ready")) {
              socket.send(JSON.stringify({ type: "input", data: "\r" }));
              resolve();
            }
          });
        }
      });
    });
    await sawResumePicker;

    insertCodexThread(codexStateDbPath, {
      id: "other-device-thread",
      title: "Other Device Session",
      cwd: fixture.cwd,
      updatedAtMs: Date.now() + 10_000
    });

    const listResponse = await server.inject({
      method: "GET",
      url: "/api/open-cozy-sessions?deviceId=device-1"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json<Array<{ id: string; name: string; codexThreadId: string | null }>>()).toContainEqual(
      expect.objectContaining({
        id: session.id,
        name: "Sessions",
        codexThreadId: null
      })
    );

    await server.inject({
      method: "DELETE",
      url: `/api/open-cozy-sessions/${session.id}`
    });
  });

  it("updates a resume picker session title immediately from the selected terminal row", async () => {
    const fixture = makeTestCodexBin([
      "process.stdout.write('\\x1b[7m  Selected Session   /work  \\x1b[0m\\r\\n');",
      "process.stdin.resume();"
    ]);
    const codexStateDbPath = createCodexStateDb(fixture.cwd);
    insertCodexThread(codexStateDbPath, {
      id: "selected-thread",
      title: "Selected Session",
      cwd: fixture.cwd,
      updatedAtMs: Date.now() - 10_000
    });
    insertCodexThread(codexStateDbPath, {
      id: "unrelated-active-thread",
      title: "Unrelated Active Session",
      cwd: fixture.cwd,
      updatedAtMs: Date.now() + 10_000
    });

    const server = buildServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: fixture.dbPath,
      codexBin: fixture.bin,
      defaultCodexCwd: fixture.cwd,
      codexStateDbPath
    });
    servers.push(server);

    await server.ready();

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/open-cozy-sessions",
      payload: {
        mode: "resume",
        cwd: fixture.cwd
      }
    });
    expect(createResponse.statusCode).toBe(201);
    const session = createResponse.json<{ id: string; name: string; codexThreadId: string | null }>();
    expect(session).toMatchObject({ name: "Sessions", codexThreadId: null });

    const selectedTitle = new Promise<{ name: string; codexThreadId: string | null }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Session title did not update from selected terminal row")), 3_000);
      let confirmedResumePicker = false;

      void server.injectWS(`/api/open-cozy-sessions/${session.id}/socket`, {}, {
        onInit: (socket) => {
          socket.on("message", (data) => {
            const parsed = JSON.parse(data.toString()) as {
              type: string;
              data?: string;
              session?: { name: string; codexThreadId: string | null };
            };

            if (parsed.type === "output" && parsed.data?.includes("Selected Session") && !confirmedResumePicker) {
              confirmedResumePicker = true;
              socket.send(JSON.stringify({ type: "input", data: "\r" }));
            }

            if (parsed.type === "status" && parsed.session?.name === "Selected Session") {
              clearTimeout(timeout);
              resolve(parsed.session);
            }
          });
        }
      });
    });

    await expect(selectedTitle).resolves.toMatchObject({
      name: "Selected Session",
      codexThreadId: "selected-thread"
    });

    await server.inject({
      method: "DELETE",
      url: `/api/open-cozy-sessions/${session.id}`
    });
  });

  it("updates a resumed session title from a matching post-resume user message", async () => {
    const fixture = makeTestCodexBin(["process.stdout.write('resume ready\\n');", "process.stdin.resume();"]);
    const codexStateDbPath = createCodexStateDb(fixture.cwd);
    const server = buildServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: fixture.dbPath,
      codexBin: fixture.bin,
      defaultCodexCwd: fixture.cwd,
      codexStateDbPath
    });
    servers.push(server);

    await server.ready();

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/open-cozy-sessions",
      payload: {
        mode: "resume",
        cwd: fixture.cwd,
        deviceId: "device-1"
      }
    });
    expect(createResponse.statusCode).toBe(201);
    const session = createResponse.json<{ id: string; name: string; codexThreadId: string | null; createdAt: string }>();
    expect(session).toMatchObject({ name: "Sessions", codexThreadId: null });

    const rolloutPath = writeCodexRollout(fixture.cwd, "resumed-rollout.jsonl", "continue selected work");
    insertCodexThread(codexStateDbPath, {
      id: "resumed-thread",
      title: "Selected Work",
      cwd: fixture.cwd,
      updatedAtMs: Date.parse(session.createdAt) + 1_000,
      firstUserMessage: "original prompt",
      rolloutPath
    });
    insertCodexThread(codexStateDbPath, {
      id: "other-active-thread",
      title: "Other Device Session",
      cwd: fixture.cwd,
      updatedAtMs: Date.parse(session.createdAt) + 2_000,
      firstUserMessage: "other prompt",
      rolloutPath: writeCodexRollout(fixture.cwd, "other-rollout.jsonl", "other prompt")
    });

    const updatedTitle = new Promise<{ name: string; codexThreadId: string | null }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Resumed session title did not update from Codex rollout metadata")), 3_000);
      let submittedPrompt = false;

      void server.injectWS(`/api/open-cozy-sessions/${session.id}/socket`, {}, {
        onInit: (socket) => {
          socket.on("message", (data) => {
            const parsed = JSON.parse(data.toString()) as {
              type: string;
              data?: string;
              session?: { name: string; codexThreadId: string | null };
            };

            if (parsed.type === "output" && parsed.data?.includes("resume ready") && !submittedPrompt) {
              submittedPrompt = true;
              socket.send(JSON.stringify({ type: "input", data: "continue selected work\r" }));
            }

            if (parsed.type === "status" && parsed.session?.name === "Selected Work") {
              clearTimeout(timeout);
              resolve(parsed.session);
            }
          });
        }
      });
    });

    await expect(updatedTitle).resolves.toMatchObject({
      name: "Selected Work",
      codexThreadId: "resumed-thread"
    });

    await server.inject({
      method: "DELETE",
      url: `/api/open-cozy-sessions/${session.id}`
    });
  });

  it("does not title a resumed session from another device's newer thread without a matching user message", async () => {
    const fixture = makeTestCodexBin(["process.stdout.write('resume ready\\n');", "process.stdin.resume();"]);
    const codexStateDbPath = createCodexStateDb(fixture.cwd);
    const server = buildServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: fixture.dbPath,
      codexBin: fixture.bin,
      defaultCodexCwd: fixture.cwd,
      codexStateDbPath
    });
    servers.push(server);

    await server.ready();

    const createResponse = await server.inject({
      method: "POST",
      url: "/api/open-cozy-sessions",
      payload: {
        mode: "resume",
        cwd: fixture.cwd,
        deviceId: "device-1"
      }
    });
    expect(createResponse.statusCode).toBe(201);
    const session = createResponse.json<{ id: string; name: string; codexThreadId: string | null; createdAt: string }>();
    expect(session).toMatchObject({ name: "Sessions", codexThreadId: null });

    insertCodexThread(codexStateDbPath, {
      id: "other-device-thread",
      title: "Other Device Session",
      cwd: fixture.cwd,
      updatedAtMs: Date.parse(session.createdAt) + 2_000,
      rolloutPath: writeCodexRollout(fixture.cwd, "other-device-rollout.jsonl", "other device prompt")
    });

    const submittedPrompt = new Promise<void>((resolve) => {
      void server.injectWS(`/api/open-cozy-sessions/${session.id}/socket`, {}, {
        onInit: (socket) => {
          socket.on("message", (data) => {
            const parsed = JSON.parse(data.toString()) as { type: string; data?: string };
            if (parsed.type === "output" && parsed.data?.includes("resume ready")) {
              socket.send(JSON.stringify({ type: "input", data: "continue selected work\r" }));
              resolve();
            }
          });
        }
      });
    });
    await submittedPrompt;
    await new Promise((resolve) => {
      setTimeout(resolve, 20);
    });

    const listResponse = await server.inject({
      method: "GET",
      url: "/api/open-cozy-sessions?deviceId=device-1"
    });
    expect(listResponse.statusCode).toBe(200);
    expect(listResponse.json<Array<{ id: string; name: string; codexThreadId: string | null }>>()).toContainEqual(
      expect.objectContaining({
        id: session.id,
        name: "Sessions",
        codexThreadId: null
      })
    );

    await server.inject({
      method: "DELETE",
      url: `/api/open-cozy-sessions/${session.id}`
    });
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
