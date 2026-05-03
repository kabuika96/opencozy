import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as pty from "@homebridge/node-pty-prebuilt-multiarch";
import type { IPty } from "@homebridge/node-pty-prebuilt-multiarch";
import type { WebSocket } from "ws";
import { CodexThreadStore } from "./codexThreadStore.js";
import { resolveCodexLaunch } from "./codexCli.js";
import type { OpenCozyConfig } from "./config.js";
import type { CreateOpenCozySessionInput, RenameOpenCozySessionInput } from "./validation.js";
import type { OpenCozySessionMode, OpenCozySessionSummary } from "./types.js";

const HISTORY_LIMIT = 200_000;
const CODEX_THREAD_SYNC_INTERVAL_MS = 1_000;

type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "close" };

const DEFAULT_SESSION_NAME: Record<OpenCozySessionMode, string> = {
  new: "Codex",
  resume: "Sessions",
  resumeLast: "Last Session"
};

function serialize(message: unknown): string {
  return JSON.stringify(message);
}

type SendableWebSocket = Pick<WebSocket, "readyState" | "OPEN" | "send">;

export function sendSerializedMessage(socket: SendableWebSocket, payload: string): boolean {
  if (socket.readyState !== socket.OPEN) {
    return false;
  }

  try {
    socket.send(payload);
    return true;
  } catch {
    return false;
  }
}

function parseClientMessage(raw: WebSocket.RawData): ClientMessage | null {
  try {
    const parsed = JSON.parse(raw.toString()) as Partial<ClientMessage>;
    if (parsed.type === "input" && typeof parsed.data === "string") {
      return parsed as ClientMessage;
    }

    if (parsed.type === "resize") {
      const cols = parsed.cols;
      const rows = parsed.rows;
      if (
        typeof cols === "number" &&
        typeof rows === "number" &&
        Number.isInteger(cols) &&
        Number.isInteger(rows) &&
        cols >= 20 &&
        rows >= 5
      ) {
        return { type: "resize", cols, rows };
      }
    }

    if (parsed.type === "close") {
      return parsed as ClientMessage;
    }
  } catch {
    return null;
  }

  return null;
}

function resolveCwd(config: OpenCozyConfig, requested: string | undefined): string {
  const cwd = path.resolve(requested || config.defaultCodexCwd);
  if (!existsSync(cwd) || !statSync(cwd).isDirectory()) {
    throw new Error(`Codex working directory does not exist: ${cwd}`);
  }

  return cwd;
}

function commandArgs(mode: OpenCozySessionMode, cwd: string): string[] {
  if (mode === "new") {
    return ["-C", cwd];
  }

  if (mode === "resumeLast") {
    return ["resume", "--last", "-C", cwd];
  }

  return ["resume", "-C", cwd];
}

function defaultSessionName(mode: OpenCozySessionMode): string {
  return DEFAULT_SESSION_NAME[mode];
}

export function buildTerminalEnv(source: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const env = { ...source };
  delete env.NO_COLOR;
  delete env.CI;
  delete env.CODEX_CI;

  return {
    ...env,
    TERM: "xterm-256color",
    COLORTERM: "truecolor",
    FORCE_COLOR: "1",
    CLICOLOR: "1",
    CLICOLOR_FORCE: "1"
  };
}

class OpenCozyPtySession {
  private readonly clients = new Set<WebSocket>();
  private readonly codexThreadStore: CodexThreadStore | null;
  private readonly ptyProcess: IPty;
  private codexThreadId: string | null = null;
  private history = "";
  private lastCodexThreadSyncAt = 0;
  private name: string;
  private pendingCodexTitle: string | null = null;
  private status: "running" | "exited" = "running";
  private userRenamed = false;
  private exitCode: number | null = null;
  private updatedAt: string;

  readonly id: string;
  readonly mode: OpenCozySessionMode;
  readonly command: string;
  readonly args: string[];
  readonly cwd: string;
  readonly createdAt: string;
  readonly createdAtMs: number;

  constructor(config: OpenCozyConfig, input: CreateOpenCozySessionInput, codexThreadStore: CodexThreadStore | null) {
    this.id = randomUUID();
    this.name = input.name || defaultSessionName(input.mode);
    this.pendingCodexTitle = input.name || null;
    this.userRenamed = Boolean(input.name);
    this.codexThreadStore = codexThreadStore;
    this.mode = input.mode;
    this.cwd = resolveCwd(config, input.cwd);
    const launch = resolveCodexLaunch(config.codexBin);
    this.command = launch.command;
    this.args = [...launch.argsPrefix, ...commandArgs(input.mode, this.cwd)];
    this.createdAtMs = Date.now();
    this.createdAt = new Date(this.createdAtMs).toISOString();
    this.updatedAt = this.createdAt;

    this.ptyProcess = pty.spawn(this.command, this.args, {
      name: "xterm-256color",
      cols: 100,
      rows: 30,
      cwd: this.cwd,
      env: buildTerminalEnv(process.env)
    });

    this.ptyProcess.onData((data) => {
      this.appendHistory(data);
      this.broadcast({ type: "output", data });
    });

    this.ptyProcess.onExit(({ exitCode }) => {
      this.status = "exited";
      this.exitCode = exitCode;
      this.touch();
      this.broadcast({ type: "exit", exitCode });
    });
  }

  summary(): OpenCozySessionSummary {
    this.syncCodexThreadTitle({ force: true });
    return this.toSummary();
  }

  private toSummary(): OpenCozySessionSummary {
    return {
      id: this.id,
      name: this.name,
      codexThreadId: this.codexThreadId,
      mode: this.mode,
      command: this.command,
      args: this.args,
      cwd: this.cwd,
      status: this.status,
      exitCode: this.exitCode,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt
    };
  }

  rename(input: RenameOpenCozySessionInput): OpenCozySessionSummary {
    this.name = input.name;
    this.pendingCodexTitle = input.name;
    this.userRenamed = true;
    this.syncCodexThreadTitle({ force: true });
    this.touch();
    this.broadcastStatus();
    return this.toSummary();
  }

  attach(socket: WebSocket): void {
    this.clients.add(socket);
    if (!this.sendToClient(socket, { type: "status", session: this.summary() })) {
      return;
    }

    if (this.history.length > 0) {
      if (!this.sendToClient(socket, { type: "output", data: this.history })) {
        return;
      }
    }

    if (this.status === "exited" && this.exitCode !== null) {
      if (!this.sendToClient(socket, { type: "exit", exitCode: this.exitCode })) {
        return;
      }
    }

    socket.on("message", (raw) => {
      const message = parseClientMessage(raw);
      if (!message) {
        return;
      }

      if (message.type === "input" && this.status === "running") {
        this.ptyProcess.write(message.data);
        this.touch();
      }

      if (message.type === "resize" && this.status === "running") {
        this.ptyProcess.resize(message.cols, message.rows);
        this.touch();
      }

      if (message.type === "close") {
        this.kill();
      }
    });

    socket.on("close", () => {
      this.clients.delete(socket);
    });
  }

  kill(): void {
    if (this.status === "running") {
      this.ptyProcess.kill();
    }
  }

  private appendHistory(data: string): void {
    this.history += data;
    if (this.history.length > HISTORY_LIMIT) {
      this.history = this.history.slice(this.history.length - HISTORY_LIMIT);
    }
    this.touch();
    if (this.syncCodexThreadTitle()) {
      this.broadcastStatus();
    }
  }

  private broadcast(message: unknown): void {
    const payload = serialize(message);
    for (const client of this.clients) {
      if (!sendSerializedMessage(client, payload)) {
        this.clients.delete(client);
      }
    }
  }

  private sendToClient(client: WebSocket, message: unknown): boolean {
    const sent = sendSerializedMessage(client, serialize(message));
    if (!sent) {
      this.clients.delete(client);
    }
    return sent;
  }

  private broadcastStatus(): void {
    this.broadcast({ type: "status", session: this.toSummary() });
  }

  private syncCodexThreadTitle(options: { force?: boolean } = {}): boolean {
    if (!this.codexThreadStore) {
      return false;
    }

    const now = Date.now();
    if (!options.force && now - this.lastCodexThreadSyncAt < CODEX_THREAD_SYNC_INTERVAL_MS) {
      return false;
    }
    this.lastCodexThreadSyncAt = now;

    const previousName = this.name;
    const previousThreadId = this.codexThreadId;
    const shouldDiscoverThread = !this.codexThreadId || (this.mode === "resume" && !this.userRenamed);
    const thread = !shouldDiscoverThread && this.codexThreadId
      ? this.codexThreadStore.getThread(this.codexThreadId)
      : this.codexThreadStore.findActiveThread(this.cwd, this.createdAtMs);

    if (!thread) {
      return false;
    }

    this.codexThreadId = thread.id;

    if (this.pendingCodexTitle) {
      if (this.codexThreadStore.updateTitle(thread.id, this.pendingCodexTitle)) {
        this.name = this.pendingCodexTitle;
        this.pendingCodexTitle = null;
      }
    } else if (thread.title) {
      this.name = thread.title;
    }

    return previousName !== this.name || previousThreadId !== this.codexThreadId;
  }

  private touch(): void {
    this.updatedAt = new Date().toISOString();
  }
}

export class TerminalSessionManager {
  private readonly sessions = new Map<string, OpenCozyPtySession>();
  private readonly codexThreadStore: CodexThreadStore | null;

  constructor(private readonly config: OpenCozyConfig) {
    this.codexThreadStore = config.codexStateDbPath ? new CodexThreadStore(config.codexStateDbPath) : null;
  }

  list(): OpenCozySessionSummary[] {
    return Array.from(this.sessions.values())
      .map((session) => session.summary())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  create(input: CreateOpenCozySessionInput): OpenCozySessionSummary {
    const session = new OpenCozyPtySession(this.config, input, this.codexThreadStore);
    this.sessions.set(session.id, session);
    return session.summary();
  }

  rename(id: string, input: RenameOpenCozySessionInput): OpenCozySessionSummary | null {
    const session = this.sessions.get(id);
    return session ? session.rename(input) : null;
  }

  attach(id: string, socket: WebSocket): boolean {
    const session = this.sessions.get(id);
    if (!session) {
      return false;
    }

    session.attach(socket);
    return true;
  }

  close(id: string): boolean {
    const session = this.sessions.get(id);
    if (!session) {
      return false;
    }

    session.kill();
    this.sessions.delete(id);
    return true;
  }

  closeAll(): void {
    for (const session of this.sessions.values()) {
      session.kill();
    }
    this.sessions.clear();
  }
}
