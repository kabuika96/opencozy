import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import * as pty from "@homebridge/node-pty-prebuilt-multiarch";
import type { IPty } from "@homebridge/node-pty-prebuilt-multiarch";
import type { WebSocket } from "ws";
import { resolveCodexLaunch } from "./codexCli.js";
import type { OpenCozyConfig } from "./config.js";
import type { CreateOpenCozySessionInput } from "./validation.js";
import type { OpenCozySessionMode, OpenCozySessionSummary } from "./types.js";

const HISTORY_LIMIT = 200_000;

type ClientMessage =
  | { type: "input"; data: string }
  | { type: "resize"; cols: number; rows: number }
  | { type: "close" };

function serialize(message: unknown): string {
  return JSON.stringify(message);
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
  private readonly ptyProcess: IPty;
  private history = "";
  private status: "running" | "exited" = "running";
  private exitCode: number | null = null;
  private updatedAt: string;

  readonly id: string;
  readonly mode: OpenCozySessionMode;
  readonly command: string;
  readonly args: string[];
  readonly cwd: string;
  readonly createdAt: string;

  constructor(config: OpenCozyConfig, input: CreateOpenCozySessionInput) {
    this.id = randomUUID();
    this.mode = input.mode;
    this.cwd = resolveCwd(config, input.cwd);
    const launch = resolveCodexLaunch(config.codexBin);
    this.command = launch.command;
    this.args = [...launch.argsPrefix, ...commandArgs(input.mode, this.cwd)];
    this.createdAt = new Date().toISOString();
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
    return {
      id: this.id,
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

  attach(socket: WebSocket): void {
    this.clients.add(socket);
    socket.send(serialize({ type: "status", session: this.summary() }));

    if (this.history.length > 0) {
      socket.send(serialize({ type: "output", data: this.history }));
    }

    if (this.status === "exited" && this.exitCode !== null) {
      socket.send(serialize({ type: "exit", exitCode: this.exitCode }));
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
  }

  private broadcast(message: unknown): void {
    const payload = serialize(message);
    for (const client of this.clients) {
      if (client.readyState === client.OPEN) {
        client.send(payload);
      }
    }
  }

  private touch(): void {
    this.updatedAt = new Date().toISOString();
  }
}

export class TerminalSessionManager {
  private readonly sessions = new Map<string, OpenCozyPtySession>();

  constructor(private readonly config: OpenCozyConfig) {}

  list(): OpenCozySessionSummary[] {
    return Array.from(this.sessions.values())
      .map((session) => session.summary())
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  create(input: CreateOpenCozySessionInput): OpenCozySessionSummary {
    const session = new OpenCozyPtySession(this.config, input);
    this.sessions.set(session.id, session);
    return session.summary();
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
