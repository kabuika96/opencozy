import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
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

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };

    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });
}

function requestText(port: number, pathValue: string, headers: Record<string, string>): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const request = httpRequest({
      hostname: "127.0.0.1",
      port,
      path: pathValue,
      headers
    }, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });
      response.on("end", () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8")
        });
      });
    });
    request.on("error", reject);
    request.end();
  });
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

  it("enforces the configured host and origin allowlist for HTTP requests", async () => {
    const fixture = makeTestCodexBin();
    const server = buildServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: fixture.dbPath,
      codexBin: fixture.bin,
      defaultCodexCwd: fixture.cwd,
      allowedHosts: ["opencozy.tailnet.test"]
    });
    servers.push(server);

    await server.ready();

    const allowedResponse = await server.inject({
      method: "GET",
      url: "/api/health",
      headers: {
        host: "opencozy.tailnet.test",
        origin: "https://opencozy.tailnet.test"
      }
    });
    expect(allowedResponse.statusCode).toBe(200);

    const localProxyResponse = await server.inject({
      method: "GET",
      url: "/api/health",
      headers: {
        host: "127.0.0.1:8788",
        origin: "https://opencozy.tailnet.test"
      }
    });
    expect(localProxyResponse.statusCode).toBe(200);

    const badHostResponse = await server.inject({
      method: "GET",
      url: "/api/health",
      headers: {
        host: "evil.test",
        origin: "https://opencozy.tailnet.test"
      }
    });
    expect(badHostResponse.statusCode).toBe(403);

    const badOriginResponse = await server.inject({
      method: "GET",
      url: "/api/health",
      headers: {
        host: "opencozy.tailnet.test",
        origin: "https://evil.test"
      }
    });
    expect(badOriginResponse.statusCode).toBe(403);
  });

  it("stores Wired Previews and attaches one to a shared OpenCozy session", async () => {
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

    const createPreviewResponse = await server.inject({
      method: "POST",
      url: "/api/wired-previews",
      payload: {
        name: "Fixture App",
        projectDirectory: fixture.cwd,
        target: { name: "App", url: "localhost:5173" },
        dependencyServices: [
          { name: "API", url: "http://127.0.0.1:3000", browserDirect: true }
        ],
        commands: [
          { label: "Start app", cwd: fixture.cwd, command: "npm run dev" }
        ]
      }
    });
    expect(createPreviewResponse.statusCode).toBe(201);
    const preview = createPreviewResponse.json<{
      id: string;
      target: { url: string };
      dependencyServices: Array<{ name: string; browserDirect: boolean }>;
      commands: Array<{ label: string; command: string }>;
    }>();
    expect(preview.target.url).toBe("http://localhost:5173/");
    expect(preview.dependencyServices).toEqual([{ name: "API", url: "http://127.0.0.1:3000/", browserDirect: true }]);
    expect(preview.commands).toEqual([{ label: "Start app", cwd: fixture.cwd, command: "npm run dev" }]);

    const searchResponse = await server.inject({
      method: "GET",
      url: "/api/wired-previews?search=fixture"
    });
    expect(searchResponse.json<Array<{ id: string }>>()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: preview.id })
    ]));

    const getPreviewResponse = await server.inject({
      method: "GET",
      url: `/api/wired-previews/${preview.id}`
    });
    expect(getPreviewResponse.statusCode).toBe(200);
    expect(getPreviewResponse.json<{ id: string; name: string }>()).toMatchObject({
      id: preview.id,
      name: "Fixture App"
    });

    const createSessionResponse = await server.inject({
      method: "POST",
      url: "/api/open-cozy-sessions",
      payload: {
        mode: "new",
        cwd: fixture.cwd,
        deviceId: "device-1"
      }
    });
    expect(createSessionResponse.statusCode).toBe(201);
    const session = createSessionResponse.json<{ id: string; wiredPreviewId: string | null }>();
    expect(session.wiredPreviewId).toBeNull();

    const attachResponse = await server.inject({
      method: "PUT",
      url: `/api/open-cozy-sessions/${session.id}/wired-preview`,
      payload: { wiredPreviewId: preview.id }
    });
    expect(attachResponse.statusCode).toBe(200);
    expect(attachResponse.json<{ wiredPreviewId: string }>()).toMatchObject({ wiredPreviewId: preview.id });

    const crossDeviceListResponse = await server.inject({
      method: "GET",
      url: `/api/open-cozy-sessions?deviceId=device-2&tabId=${session.id}`
    });
    expect(crossDeviceListResponse.json<Array<{ id: string; wiredPreviewId: string | null }>>()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: session.id,
        wiredPreviewId: preview.id
      })
    ]));

    const renameResponse = await server.inject({
      method: "PUT",
      url: `/api/wired-previews/${preview.id}`,
      payload: {
        name: "Renamed Fixture App",
        projectDirectory: fixture.cwd,
        target: { name: "App", url: "http://localhost:5173/" },
        dependencyServices: preview.dependencyServices,
        commands: preview.commands
      }
    });
    expect(renameResponse.statusCode).toBe(200);
    expect(renameResponse.json<{ name: string }>()).toMatchObject({ name: "Renamed Fixture App" });

    const detachResponse = await server.inject({
      method: "DELETE",
      url: `/api/open-cozy-sessions/${session.id}/wired-preview`
    });
    expect(detachResponse.statusCode).toBe(200);
    expect(detachResponse.json<{ wiredPreviewId: string | null }>()).toMatchObject({ wiredPreviewId: null });

    await server.inject({
      method: "PUT",
      url: `/api/open-cozy-sessions/${session.id}/wired-preview`,
      payload: { wiredPreviewId: preview.id }
    });

    const deleteResponse = await server.inject({
      method: "DELETE",
      url: `/api/wired-previews/${preview.id}`
    });
    expect(deleteResponse.statusCode).toBe(204);

    const detachedAfterDeleteResponse = await server.inject({
      method: "GET",
      url: `/api/open-cozy-sessions?deviceId=device-2&tabId=${session.id}`
    });
    expect(detachedAfterDeleteResponse.json<Array<{ id: string; wiredPreviewId: string | null }>>()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: session.id,
        wiredPreviewId: null
      })
    ]));
  });

  it("stores Preview Manifests pending approval and reuses unchanged submissions", async () => {
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

    const manifestPayload = {
      name: "Fixture App",
      projectDirectory: fixture.cwd,
      target: { name: "App", url: "localhost:5173" },
      dependencyServices: [
        { name: "API", url: "http://127.0.0.1:3000", browserDirect: true }
      ],
      commands: [
        { label: "Start app", cwd: fixture.cwd, command: "npm run dev" }
      ],
      requestedPublishedOrigins: [
        { name: "App HTTPS", url: "https://fixture-app.tailnet.example.ts.net/" }
      ]
    };

    const invalidResponse = await server.inject({
      method: "POST",
      url: "/api/preview-manifests",
      payload: {
        ...manifestPayload,
        extra: true
      }
    });
    expect(invalidResponse.statusCode).toBe(400);
    expect(invalidResponse.json<{ error: string }>().error).toBe("manifest.extra is not allowed");

    const submitResponse = await server.inject({
      method: "POST",
      url: "/api/preview-manifests",
      payload: manifestPayload
    });
    expect(submitResponse.statusCode).toBe(201);
    const pendingManifest = submitResponse.json<{
      id: string;
      status: string;
      approvedWiredPreviewId: string | null;
      target: { url: string };
      dependencyServices: Array<{ url: string; browserDirect: boolean }>;
      requestedPublishedOrigins: Array<{ name: string; url: string }>;
    }>();
    expect(pendingManifest).toMatchObject({
      id: expect.any(String),
      status: "pending",
      approvedWiredPreviewId: null,
      target: { url: "http://localhost:5173/" },
      dependencyServices: [{ url: "http://127.0.0.1:3000/", browserDirect: true }],
      requestedPublishedOrigins: [{ name: "App HTTPS", url: "https://fixture-app.tailnet.example.ts.net/" }]
    });

    const pendingListResponse = await server.inject({
      method: "GET",
      url: "/api/preview-manifests?status=pending"
    });
    expect(pendingListResponse.json<Array<{ id: string }>>()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: pendingManifest.id })
    ]));

    const approvalValidationResponse = await server.inject({
      method: "PUT",
      url: `/api/preview-manifests/${pendingManifest.id}/approve`,
      payload: {}
    });
    expect(approvalValidationResponse.statusCode).toBe(400);

    const approvalResponse = await server.inject({
      method: "PUT",
      url: `/api/preview-manifests/${pendingManifest.id}/approve`,
      payload: { name: "Confirmed Fixture App" }
    });
    expect(approvalResponse.statusCode).toBe(200);
    const approval = approvalResponse.json<{
      manifest: { status: string; approvedWiredPreviewId: string };
      wiredPreview: {
        id: string;
        name: string;
        target: { url: string };
        requestedPublishedOrigins: Array<{ name: string; url: string }>;
      };
    }>();
    expect(approval.manifest).toMatchObject({
      status: "approved",
      approvedWiredPreviewId: approval.wiredPreview.id
    });
    expect(approval.wiredPreview).toMatchObject({
      name: "Confirmed Fixture App",
      target: { url: "http://localhost:5173/" },
      requestedPublishedOrigins: [{ name: "App HTTPS", url: "https://fixture-app.tailnet.example.ts.net/" }]
    });

    const unchangedResponse = await server.inject({
      method: "POST",
      url: "/api/preview-manifests",
      payload: manifestPayload
    });
    expect(unchangedResponse.statusCode).toBe(200);
    expect(unchangedResponse.json<{ status: string; approvedWiredPreviewId: string }>()).toMatchObject({
      status: "approved",
      approvedWiredPreviewId: approval.wiredPreview.id
    });

    const unchangedExistingPreviewResponse = await server.inject({
      method: "POST",
      url: "/api/preview-manifests",
      payload: {
        ...manifestPayload,
        wiredPreviewId: approval.wiredPreview.id
      }
    });
    expect(unchangedExistingPreviewResponse.statusCode).toBe(200);
    expect(unchangedExistingPreviewResponse.json<{ status: string; approvedWiredPreviewId: string }>()).toMatchObject({
      status: "approved",
      approvedWiredPreviewId: approval.wiredPreview.id
    });

    const changedResponse = await server.inject({
      method: "POST",
      url: "/api/preview-manifests",
      payload: {
        ...manifestPayload,
        wiredPreviewId: approval.wiredPreview.id,
        target: { name: "App", url: "localhost:5174" }
      }
    });
    expect(changedResponse.statusCode).toBe(201);
    expect(changedResponse.json<{ status: string; approvedWiredPreviewId: string | null; target: { url: string } }>()).toMatchObject({
      status: "pending",
      approvedWiredPreviewId: null,
      target: { url: "http://localhost:5174/" }
    });

    const previewsResponse = await server.inject({
      method: "GET",
      url: "/api/wired-previews"
    });
    expect(previewsResponse.json<Array<{ id: string; target: { url: string } }>>()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: approval.wiredPreview.id,
        target: expect.objectContaining({ url: "http://localhost:5173/" })
      })
    ]));
  });

  it("launches visible Preview Wiring Sessions with process initial prompts", async () => {
    const fixture = makeTestCodexBin([
      "process.stdout.write('fake codex ready\\n');",
      "process.stdin.on('data', () => {});",
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

    const invalidResponse = await server.inject({
      method: "POST",
      url: "/api/preview-wiring-sessions",
      payload: {}
    });
    expect(invalidResponse.statusCode).toBe(400);

    const longProjectBrief = `mobile app ${"details ".repeat(1_000)}`;
    const freshResponse = await server.inject({
      method: "POST",
      url: "/api/preview-wiring-sessions",
      payload: {
        deviceId: "device-1",
        projectSearchBrief: longProjectBrief
      }
    });
    expect(freshResponse.statusCode).toBe(201);
    const freshLaunch = freshResponse.json<{
      session: { id: string; name: string; deviceId: string | null; args: string[] };
      prompt: string;
      reused: boolean;
      wiredPreview: null;
    }>();
    expect(freshLaunch).toMatchObject({
      session: {
        id: expect.any(String),
        name: "Wire Preview",
        deviceId: "device-1"
      },
      reused: false,
      wiredPreview: null
    });
    expect(freshLaunch.prompt.length).toBeLessThan(600);
    expect(freshLaunch.prompt).not.toContain("\n");
    expect(freshLaunch.prompt).toContain("/api/preview-manifests");
    expect(freshLaunch.prompt).toContain(`preview-wiring-sessions/${freshLaunch.session.id}.md`);
    expect(freshLaunch.session.args.at(-1)).toBe(freshLaunch.prompt);
    const freshPromptFilePath = new RegExp(`"([^"]*preview-wiring-sessions/${freshLaunch.session.id}\\.md)"`).exec(freshLaunch.prompt)?.[1];
    expect(freshPromptFilePath).toBeTruthy();
    const freshPromptFile = readFileSync(freshPromptFilePath ?? "", "utf8");
    expect(freshPromptFile).toContain(`Project Search Brief: ${longProjectBrief.trim()}`);
    expect(freshPromptFile).toContain(`"wiringSessionId": "${freshLaunch.session.id}"`);
    expect(freshPromptFile).toContain("ask them to confirm");
    expect(freshPromptFile).toContain("include it in requestedPublishedOrigins");

    const deviceSessionsResponse = await server.inject({
      method: "GET",
      url: "/api/open-cozy-sessions?deviceId=device-1"
    });
    expect(deviceSessionsResponse.json<Array<{ id: string }>>()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: freshLaunch.session.id })
    ]));

    const createPreviewResponse = await server.inject({
      method: "POST",
      url: "/api/wired-previews",
      payload: {
        name: "Fixture App",
        projectDirectory: fixture.cwd,
        target: { name: "App", url: "localhost:5173" },
        dependencyServices: [],
        commands: [
          { label: "Start app", cwd: fixture.cwd, command: "npm run dev" }
        ],
        requestedPublishedOrigins: [
          { name: "App", url: "http://127.0.0.1:5173/" }
        ]
      }
    });
    expect(createPreviewResponse.statusCode).toBe(201);
    const preview = createPreviewResponse.json<{ id: string }>();

    const updateLaunchResponse = await server.inject({
      method: "POST",
      url: "/api/preview-wiring-sessions",
      payload: {
        deviceId: "device-1",
        projectSearchBrief: "fixture app update",
        wiredPreviewId: preview.id
      }
    });
    expect(updateLaunchResponse.statusCode).toBe(201);
    const updateLaunch = updateLaunchResponse.json<{
      session: { id: string; cwd: string; name: string; args: string[] };
      prompt: string;
      reused: boolean;
      wiredPreview: { id: string; wiringSessionId: string | null };
    }>();
    expect(updateLaunch).toMatchObject({
      session: {
        id: expect.any(String),
        cwd: fixture.cwd,
        name: "Wire Fixture App"
      },
      reused: false,
      wiredPreview: {
        id: preview.id,
        wiringSessionId: updateLaunch.session.id
      }
    });
    expect(updateLaunch.prompt.length).toBeLessThan(600);
    expect(updateLaunch.prompt).not.toContain("\n");
    expect(updateLaunch.prompt).toContain(`preview-wiring-sessions/${updateLaunch.session.id}.md`);
    expect(updateLaunch.session.args.at(-1)).toBe(updateLaunch.prompt);
    const updatePromptFilePath = new RegExp(`"([^"]*preview-wiring-sessions/${updateLaunch.session.id}\\.md)"`).exec(updateLaunch.prompt)?.[1];
    expect(updatePromptFilePath).toBeTruthy();
    const updatePromptFile = readFileSync(updatePromptFilePath ?? "", "utf8");
    expect(updatePromptFile).toContain(`Existing Wired Preview: Fixture App (${preview.id})`);
    expect(updatePromptFile).toContain(`"wiredPreviewId": "${preview.id}"`);
    expect(updatePromptFile).toContain("Stored Preview Commands:");
    expect(updatePromptFile).toContain("command: npm run dev");
    expect(updatePromptFile).toContain("ask before running anything");

    const recoveryLaunchResponse = await server.inject({
      method: "POST",
      url: "/api/preview-wiring-sessions",
      payload: {
        deviceId: "device-1",
        projectSearchBrief: "fixture app update",
        wiredPreviewId: preview.id
      }
    });
    expect(recoveryLaunchResponse.statusCode).toBe(201);
    const recoveryLaunch = recoveryLaunchResponse.json<{
      session: { id: string; cwd: string; name: string; args: string[] };
      prompt: string;
      reused: boolean;
      wiredPreview: { id: string; wiringSessionId: string | null };
    }>();
    expect(recoveryLaunch.session.id).not.toBe(updateLaunch.session.id);
    expect(recoveryLaunch).toMatchObject({
      session: {
        cwd: fixture.cwd,
        name: "Wire Fixture App"
      },
      reused: false,
      wiredPreview: {
        id: preview.id,
        wiringSessionId: recoveryLaunch.session.id
      }
    });
    expect(recoveryLaunch.prompt).not.toContain("\n");
    expect(recoveryLaunch.prompt).toContain(`preview-wiring-sessions/${recoveryLaunch.session.id}.md`);
    expect(recoveryLaunch.session.args.at(-1)).toBe(recoveryLaunch.prompt);
  });

  it("publishes and unpublishes a Wired Preview target through Tailscale Serve", async () => {
    const fixture = makeTestCodexBin();
    const tailscaleBin = path.join(fixture.cwd, "fake-tailscale.js");
    const commandLog = path.join(fixture.cwd, "tailscale-commands.jsonl");
    writeFileSync(
      tailscaleBin,
      [
        "#!/usr/bin/env node",
        "const fs = require('fs');",
        "const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--socket='));",
        `fs.appendFileSync(${JSON.stringify(commandLog)}, JSON.stringify(args) + "\\n");`,
        "if (args[0] === 'status' && args[1] === '--json') {",
        "  process.stdout.write(JSON.stringify({ Self: { DNSName: 'jarvis.tailnet.test.', Online: true } }));",
        "  process.exit(0);",
        "}",
        "if (args[0] === 'serve' && args[1] === '--bg' && args[2] === '--https=8443' && /^http:\\/\\/127\\.0\\.0\\.1:\\d+\\/$/.test(args[3])) {",
        "  process.exit(0);",
        "}",
        "if (args[0] === 'serve' && args[1] === '--bg' && args[2] === '--https=8444' && /^http:\\/\\/127\\.0\\.0\\.1:\\d+\\/$/.test(args[3])) {",
        "  process.exit(0);",
        "}",
        "if (args[0] === 'serve' && args[1] === '--https=8443' && args[2] === 'off') {",
        "  process.exit(0);",
        "}",
        "process.stderr.write(`unexpected args: ${JSON.stringify(args)}`);",
        "process.exit(2);"
      ].join("\n")
    );
    chmodSync(tailscaleBin, 0o755);

    const server = buildServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: fixture.dbPath,
      codexBin: fixture.bin,
      defaultCodexCwd: fixture.cwd,
      tailscaleBin,
      previewPublishPortStart: 8443,
      previewPublishPortEnd: 8444,
      previewProxyPortStart: 0,
      previewProxyPortEnd: 0
    });
    servers.push(server);

    await server.ready();

    const createPreviewResponse = await server.inject({
      method: "POST",
      url: "/api/wired-previews",
      payload: {
        name: "Fixture App",
        projectDirectory: fixture.cwd,
        target: { name: "App", url: "http://127.0.0.1:5173/path" },
        dependencyServices: [
          { name: "API", url: "http://127.0.0.1:3000/api", browserDirect: true },
          { name: "Database", url: "http://127.0.0.1:5432", browserDirect: false }
        ],
        commands: [],
        requestedPublishedOrigins: []
      }
    });
    expect(createPreviewResponse.statusCode).toBe(201);
    const preview = createPreviewResponse.json<{ id: string }>();

    const emptyOriginsResponse = await server.inject({
      method: "GET",
      url: `/api/wired-previews/${preview.id}/published-origins`
    });
    expect(emptyOriginsResponse.statusCode).toBe(200);
    expect(emptyOriginsResponse.json()).toEqual([]);

    const publishResponse = await server.inject({
      method: "POST",
      url: `/api/wired-previews/${preview.id}/published-origins`,
      payload: { source: "target" }
    });
    expect(publishResponse.statusCode).toBe(201);
    const published = publishResponse.json<{
      origin: { id: string; sourceUrl: string; publishedUrl: string; httpsPort: number; status: string };
      wiredPreview: { publishedOrigins: Array<{ id: string; status: string }> };
    }>();
    expect(published).toMatchObject({
      origin: {
        sourceUrl: "http://127.0.0.1:5173/",
        publishedUrl: "https://jarvis.tailnet.test:8443/",
        httpsPort: 8443,
        status: "published"
      },
      origins: [
        expect.objectContaining({
          sourceUrl: "http://127.0.0.1:5173/",
          publishedUrl: "https://jarvis.tailnet.test:8443/"
        })
      ],
      wiredPreview: {
        publishedOrigins: [
          expect.objectContaining({ status: "published" })
        ]
      }
    });

    const dependencyPublishResponse = await server.inject({
      method: "POST",
      url: `/api/wired-previews/${preview.id}/published-origins`,
      payload: { source: "browserDirectDependencyServices" }
    });
    expect(dependencyPublishResponse.statusCode).toBe(201);
    expect(dependencyPublishResponse.json<{
      origins: Array<{ source: string; dependencyServiceName: string | null; sourceUrl: string; publishedUrl: string; httpsPort: number }>;
    }>().origins).toEqual([
      expect.objectContaining({
        source: "dependency-service",
        dependencyServiceName: "API",
        sourceUrl: "http://127.0.0.1:3000/",
        publishedUrl: "https://jarvis.tailnet.test:8444/",
        httpsPort: 8444
      })
    ]);

    const hostLocalPublishResponse = await server.inject({
      method: "POST",
      url: `/api/wired-previews/${preview.id}/published-origins`,
      payload: { source: "dependencyService", dependencyServiceIndex: 1 }
    });
    expect(hostLocalPublishResponse.statusCode).toBe(400);
    expect(hostLocalPublishResponse.json<{ error: string }>().error).toBe("Dependency Service is host-local; mark it browserDirect before publishing");

    const originsResponse = await server.inject({
      method: "GET",
      url: `/api/wired-previews/${preview.id}/published-origins`
    });
    expect(originsResponse.json<Array<{ id: string; source: string; status: string }>>()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: published.origin.id, source: "target", status: "published" }),
      expect.objectContaining({ source: "dependency-service", status: "published" })
    ]));

    const unpublishResponse = await server.inject({
      method: "DELETE",
      url: `/api/wired-previews/${preview.id}/published-origins/${published.origin.id}`
    });
    expect(unpublishResponse.statusCode).toBe(200);
    expect(unpublishResponse.json<{ origin: { status: string } }>().origin.status).toBe("unpublished");

    const commands = readFileSync(commandLog, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as string[]);
    expect(commands).toEqual([
      ["status", "--json"],
      ["serve", "--bg", "--https=8443", expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/$/)],
      ["status", "--json"],
      ["serve", "--bg", "--https=8444", expect.stringMatching(/^http:\/\/127\.0\.0\.1:\d+\/$/)],
      ["serve", "--https=8443", "off"]
    ]);
  });

  it("proxies published Preview Origin requests with the target Host header", async () => {
    const fixture = makeTestCodexBin();
    const targetServer = createServer((request, response) => {
      const expectedHost = `127.0.0.1:${(targetServer.address() as { port: number }).port}`;
      if (request.headers.host !== expectedHost) {
        response.statusCode = 403;
        response.end(`Blocked request. This host (${request.headers.host}) is not allowed.`);
        return;
      }

      response.setHeader("content-type", "text/plain");
      response.end(`ok ${request.url}`);
    });
    await listen(targetServer);

    try {
      const targetAddress = targetServer.address();
      if (!targetAddress || typeof targetAddress === "string") {
        throw new Error("Target server did not bind to a TCP port");
      }

      const tailscaleBin = path.join(fixture.cwd, "fake-tailscale.js");
      writeFileSync(
        tailscaleBin,
        [
          "#!/usr/bin/env node",
          "const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--socket='));",
          "if (args[0] === 'status' && args[1] === '--json') {",
          "  process.stdout.write(JSON.stringify({ Self: { DNSName: 'jarvis.tailnet.test.', Online: true } }));",
          "  process.exit(0);",
          "}",
          "if (args[0] === 'serve' && args[1] === '--bg' && args[2] === '--https=8443' && /^http:\\/\\/127\\.0\\.0\\.1:\\d+\\/$/.test(args[3])) {",
          "  process.exit(0);",
          "}",
          "process.stderr.write(`unexpected args: ${JSON.stringify(args)}`);",
          "process.exit(2);"
        ].join("\n")
      );
      chmodSync(tailscaleBin, 0o755);

      const server = buildServer({
        host: "127.0.0.1",
        port: 8788,
        dbPath: fixture.dbPath,
        codexBin: fixture.bin,
        defaultCodexCwd: fixture.cwd,
        tailscaleBin,
        allowedHosts: ["jarvis.tailnet.test"],
        previewPublishPortStart: 8443,
        previewPublishPortEnd: 8443,
        previewProxyPortStart: 0,
        previewProxyPortEnd: 0
      });
      servers.push(server);

      await server.ready();

      const createPreviewResponse = await server.inject({
        method: "POST",
        url: "/api/wired-previews",
        payload: {
          name: "Vite App",
          projectDirectory: fixture.cwd,
          target: { name: "App", url: `http://127.0.0.1:${targetAddress.port}/` },
          dependencyServices: [],
          commands: [],
          requestedPublishedOrigins: []
        }
      });
      expect(createPreviewResponse.statusCode).toBe(201);
      const preview = createPreviewResponse.json<{ id: string }>();

      const publishResponse = await server.inject({
        method: "POST",
        url: `/api/wired-previews/${preview.id}/published-origins`,
        payload: { source: "target" }
      });
      expect(publishResponse.statusCode).toBe(201);
      const published = publishResponse.json<{ origin: { id: string; publishedUrl: string; localProxyPort: number } }>();
      expect(published.origin.publishedUrl).toBe("https://jarvis.tailnet.test:8443/");

      const proxyResponse = await requestText(
        published.origin.localProxyPort,
        "/@vite/client?x=1",
        {
          host: "jarvis.tailnet.test:8443",
          origin: "https://jarvis.tailnet.test:8443"
        }
      );

      expect(proxyResponse.statusCode).toBe(200);
      expect(proxyResponse.body).toBe("ok /@vite/client?x=1");
    } finally {
      await new Promise<void>((resolve, reject) => {
        targetServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });

  it("enforces the configured host and origin allowlist for WebSocket upgrades", async () => {
    const fixture = makeTestCodexBin();
    const server = buildServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: fixture.dbPath,
      codexBin: fixture.bin,
      defaultCodexCwd: fixture.cwd,
      allowedHosts: ["opencozy.tailnet.test"]
    });
    servers.push(server);

    await server.ready();

    const allowedHeaders = {
      host: "opencozy.tailnet.test",
      origin: "https://opencozy.tailnet.test"
    };
    const createResponse = await server.inject({
      method: "POST",
      url: "/api/open-cozy-sessions",
      headers: allowedHeaders,
      payload: {
        mode: "new",
        name: "WAN Guard",
        cwd: fixture.cwd
      }
    });
    expect(createResponse.statusCode).toBe(201);

    const session = createResponse.json<{ id: string }>();
    const ws = await server.injectWS(`/api/open-cozy-sessions/${session.id}/socket`, { headers: allowedHeaders });
    ws.terminate();

    await expect(
      server.injectWS(`/api/open-cozy-sessions/${session.id}/socket`, {
        headers: {
          host: "evil.test",
          origin: "https://evil.test"
        }
      })
    ).rejects.toThrow("Unexpected server response: 403");

    await server.inject({
      method: "DELETE",
      url: `/api/open-cozy-sessions/${session.id}`,
      headers: allowedHeaders
    });
  });

  it("reports WAN tunnel configuration and Tailscale state", async () => {
    const fixture = makeTestCodexBin();
    const tailscaleBin = path.join(fixture.cwd, "fake-tailscale.js");
    writeFileSync(
      tailscaleBin,
      [
        "#!/usr/bin/env node",
        "const args = process.argv.slice(2).filter((arg) => !arg.startsWith('--socket='));",
        "if (args[0] === 'status' && args[1] === '--json') {",
        "  process.stdout.write(JSON.stringify({",
        "    Version: '1.2.3',",
        "    BackendState: 'Running',",
        "    MagicDNSSuffix: 'tailnet.example.ts.net',",
        "    Self: {",
        "      HostName: 'jarvis-opencozy',",
        "      DNSName: 'jarvis-opencozy.tailnet.example.ts.net.',",
        "      Online: true,",
        "      TailscaleIPs: ['100.72.10.3']",
        "    }",
        "  }));",
        "  process.exit(0);",
        "}",
        "if (args[0] === 'serve' && args[1] === 'status') {",
        "  process.stdout.write('https://jarvis-opencozy.tailnet.example.ts.net\\n|-- proxy http://127.0.0.1:5175\\n');",
        "  process.exit(0);",
        "}",
        "process.stderr.write(`unexpected args: ${args.join(' ')}\\n`);",
        "process.exit(2);"
      ].join("\n")
    );
    chmodSync(tailscaleBin, 0o755);

    const server = buildServer({
      host: "127.0.0.1",
      port: 0,
      dbPath: fixture.dbPath,
      codexBin: fixture.bin,
      defaultCodexCwd: fixture.cwd,
      allowedHosts: ["jarvis.local", "jarvis-opencozy.tailnet.example.ts.net"],
      frontendPort: 5175,
      tailscaleBin,
      tailscaleSocket: "/tmp/opencozy-tailscaled.sock"
    });
    servers.push(server);

    await server.ready();

    const response = await server.inject({
      method: "GET",
      url: "/api/wan-tunnel"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      config: {
        allowedHosts: ["jarvis.local", "jarvis-opencozy.tailnet.example.ts.net"],
        backendHost: "127.0.0.1",
        backendLocalOnly: true,
        frontendPort: 5175,
        serveTarget: "http://127.0.0.1:5175",
        tailscaleSocket: "/tmp/opencozy-tailscaled.sock"
      },
      tailscale: {
        backendState: "Running",
        cliAvailable: true,
        daemonReachable: true,
        dnsName: "jarvis-opencozy.tailnet.example.ts.net",
        httpsOrigin: "https://jarvis-opencozy.tailnet.example.ts.net",
        ips: ["100.72.10.3"],
        nodeName: "jarvis-opencozy",
        serveConfigured: true,
        tailnetSuffix: "tailnet.example.ts.net",
        version: "1.2.3"
      }
    });
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
