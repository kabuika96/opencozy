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
const OUTPUT_FLUSH_DELAY_MS = 24;
const OUTPUT_FRAME_LIMIT = 64_000;
/* eslint-disable no-control-regex -- ANSI terminal parsing intentionally matches control sequences. */
const CSI_PATTERN = new RegExp("\\u001b\\[[0-?]*[ -/]*[@-~]", "g");
const OSC_PATTERN = new RegExp("\\u001b\\][^\\u0007]*(?:\\u0007|\\u001b\\\\)", "g");
const CONTROL_PATTERN = new RegExp("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]", "g");
const SGR_PATTERN = new RegExp("\\u001b\\[([0-9;]*)m", "g");
/* eslint-enable no-control-regex */
const PICKER_ROW_MARKER_PATTERN = /^(?:>|\u203a|\u276f)\s*/;

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
type AttachOptions = {
  replayHistory?: boolean;
};
type ListOptions = {
  deviceId?: string;
  tabIds?: string[];
};

export function sendSerializedMessage(socket: SendableWebSocket, payload: string, onError?: () => void): boolean {
  if (socket.readyState !== socket.OPEN) {
    return false;
  }

  try {
    socket.send(payload, (error) => {
      if (error) {
        onError?.();
      }
    });
    return true;
  } catch {
    return false;
  }
}

export function splitTerminalOutput(output: string): string[] {
  const chunks: string[] = [];
  for (let index = 0; index < output.length; index += OUTPUT_FRAME_LIMIT) {
    chunks.push(output.slice(index, index + OUTPUT_FRAME_LIMIT));
  }
  return chunks;
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

function commandArgs(mode: OpenCozySessionMode, cwd: string, codexThreadId?: string): string[] {
  if (mode === "new") {
    return ["-C", cwd];
  }

  if (mode === "resumeLast") {
    return codexThreadId ? ["resume", codexThreadId, "-C", cwd] : ["resume", "-C", cwd];
  }

  return ["resume", "-C", cwd];
}

function defaultSessionName(mode: OpenCozySessionMode): string {
  return DEFAULT_SESSION_NAME[mode];
}

function hasLineSubmission(data: string): boolean {
  return data.includes("\r") || data.includes("\n");
}

function readPrintableInputLine(draft: string, data: string): { draft: string; submitted: string | null } {
  let nextDraft = draft;

  for (let index = 0; index < data.length; index += 1) {
    const character = data[index];

    if (character === "\r" || character === "\n") {
      const submitted = nextDraft.trim();
      nextDraft = "";
      if (submitted) {
        return { draft: nextDraft, submitted };
      }
      continue;
    }

    if (character === "\b" || character === "\u007f") {
      nextDraft = nextDraft.slice(0, -1);
      continue;
    }

    if (character === "\u0003") {
      nextDraft = "";
      continue;
    }

    if (character === "\u001b") {
      if (data[index + 1] === "[") {
        for (let cursor = index + 2; cursor < data.length; cursor += 1) {
          const code = data.charCodeAt(cursor);
          if (code >= 0x40 && code <= 0x7e) {
            index = cursor;
            break;
          }
        }
      }
      continue;
    }

    if (character >= " " || character === "\t") {
      nextDraft += character;
    }
  }

  return { draft: nextDraft, submitted: null };
}

function stripAnsiControl(text: string): string {
  return text
    .replace(CSI_PATTERN, "")
    .replace(OSC_PATTERN, "")
    .replace(CONTROL_PATTERN, "");
}

function isReverseSgr(params: string): boolean {
  return params.split(";").some((part) => part === "7");
}

function isReverseResetSgr(params: string): boolean {
  return params === "" || params.split(";").some((part) => part === "0" || part === "27");
}

export function extractResumePickerSelectionText(output: string): string | null {
  const tail = output.slice(-50_000);
  const selectedSegments: string[] = [];
  let selected = "";
  let reverse = false;
  let index = 0;
  let match: RegExpExecArray | null;

  SGR_PATTERN.lastIndex = 0;
  while ((match = SGR_PATTERN.exec(tail)) !== null) {
    if (reverse) {
      selected += tail.slice(index, match.index);
    }

    const params = match[1] || "";
    if (isReverseSgr(params)) {
      reverse = true;
    } else if (isReverseResetSgr(params)) {
      if (selected.trim()) {
        selectedSegments.push(selected);
      }
      selected = "";
      reverse = false;
    }

    index = match.index + match[0].length;
  }

  if (reverse) {
    selected += tail.slice(index);
  }
  if (selected.trim()) {
    selectedSegments.push(selected);
  }

  for (const segment of selectedSegments.reverse()) {
    const text = stripAnsiControl(segment).replace(/\s+/g, " ").trim();
    if (text) {
      return text;
    }
  }

  const lines = stripAnsiControl(tail).split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  return lines.reverse().find((line) => PICKER_ROW_MARKER_PATTERN.test(line)) || null;
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
  private codexThreadSyncTimer: ReturnType<typeof setInterval> | null = null;
  private codexThreadId: string | null = null;
  private history = "";
  private lastCodexThreadSyncAt = 0;
  private name: string;
  private outputFlushTimer: ReturnType<typeof setTimeout> | null = null;
  private pendingOutput = "";
  private pendingCodexTitle: string | null = null;
  private pendingInputLine = "";
  private status: "running" | "exited" = "running";
  private firstSubmittedUserMessage: string | null = null;
  private latestSubmittedUserMessage: string | null = null;
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
  readonly deviceId: string | null;

  constructor(config: OpenCozyConfig, input: CreateOpenCozySessionInput, codexThreadStore: CodexThreadStore | null) {
    this.id = randomUUID();
    this.name = input.name || defaultSessionName(input.mode);
    this.pendingCodexTitle = input.name || null;
    this.userRenamed = Boolean(input.name);
    this.codexThreadStore = codexThreadStore;
    this.mode = input.mode;
    this.deviceId = input.deviceId || null;
    const requestedCodexThreadId = input.mode === "resumeLast" ? input.codexThreadId : undefined;
    this.codexThreadId = requestedCodexThreadId || null;
    this.cwd = resolveCwd(config, input.cwd);
    const launch = resolveCodexLaunch(config.codexBin);
    this.command = launch.command;
    this.args = [...launch.argsPrefix, ...commandArgs(input.mode, this.cwd, requestedCodexThreadId)];
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
      this.queueOutput(data);
    });

    this.ptyProcess.onExit(({ exitCode }) => {
      this.flushOutput();
      this.stopCodexThreadSync();
      this.status = "exited";
      this.exitCode = exitCode;
      this.touch();
      this.broadcast({ type: "exit", exitCode });
    });

    if (this.codexThreadStore && (this.mode === "resume" || this.mode === "resumeLast")) {
      this.startCodexThreadSync();
    }
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
      deviceId: this.deviceId,
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

  attach(socket: WebSocket, options: AttachOptions = {}): void {
    this.clients.add(socket);
    if (!this.sendToClient(socket, { type: "status", session: this.summary() })) {
      return;
    }

    if (options.replayHistory !== false && this.history.length > 0) {
      if (!this.sendOutputToClient(socket, this.history)) {
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
        if (this.markInputActivity(message.data)) {
          this.broadcastStatus();
        }
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
    socket.on("error", () => {
      this.clients.delete(socket);
    });
  }

  kill(): void {
    this.flushOutput();
    this.stopCodexThreadSync();
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

  private queueOutput(data: string): void {
    this.pendingOutput += data;
    if (this.outputFlushTimer) {
      return;
    }

    this.outputFlushTimer = setTimeout(() => {
      this.flushOutput();
    }, OUTPUT_FLUSH_DELAY_MS);
    this.outputFlushTimer.unref?.();
  }

  private flushOutput(): void {
    if (this.outputFlushTimer) {
      clearTimeout(this.outputFlushTimer);
      this.outputFlushTimer = null;
    }

    const output = this.pendingOutput;
    if (!output) {
      return;
    }
    this.pendingOutput = "";

    this.broadcastOutput(output);
  }

  private broadcast(message: unknown): void {
    const payload = serialize(message);
    for (const client of this.clients) {
      if (!sendSerializedMessage(client, payload, () => this.clients.delete(client))) {
        this.clients.delete(client);
      }
    }
  }

  private sendToClient(client: WebSocket, message: unknown): boolean {
    const sent = sendSerializedMessage(client, serialize(message), () => this.clients.delete(client));
    if (!sent) {
      this.clients.delete(client);
    }
    return sent;
  }

  private broadcastOutput(output: string): void {
    for (const chunk of splitTerminalOutput(output)) {
      this.broadcast({ type: "output", data: chunk });
    }
  }

  private sendOutputToClient(client: WebSocket, output: string): boolean {
    for (const chunk of splitTerminalOutput(output)) {
      if (!this.sendToClient(client, { type: "output", data: chunk })) {
        return false;
      }
    }
    return true;
  }

  private broadcastStatus(): void {
    this.broadcast({ type: "status", session: this.toSummary() });
  }

  private startCodexThreadSync(): void {
    if (this.codexThreadSyncTimer) {
      return;
    }

    this.codexThreadSyncTimer = setInterval(() => {
      if (this.status !== "running") {
        this.stopCodexThreadSync();
        return;
      }

      if (this.syncCodexThreadTitle()) {
        this.broadcastStatus();
      }

      if (this.isCodexThreadSyncSettled()) {
        this.stopCodexThreadSync();
      }
    }, CODEX_THREAD_SYNC_INTERVAL_MS);
    this.codexThreadSyncTimer.unref?.();
  }

  private stopCodexThreadSync(): void {
    if (!this.codexThreadSyncTimer) {
      return;
    }

    clearInterval(this.codexThreadSyncTimer);
    this.codexThreadSyncTimer = null;
  }

  private isCodexThreadSyncSettled(): boolean {
    return Boolean(this.codexThreadId) && !this.pendingCodexTitle && this.name !== defaultSessionName(this.mode);
  }

  private markInputActivity(data: string): boolean {
    const didUpdateFromSubmittedPrompt = this.markSubmittedPromptActivity(data);
    const didUpdateFromResumePicker = this.markResumePickerActivity(data);
    return didUpdateFromSubmittedPrompt || didUpdateFromResumePicker;
  }

  private markSubmittedPromptActivity(data: string): boolean {
    if ((this.mode !== "new" && this.mode !== "resume" && this.mode !== "resumeLast") || this.codexThreadId) {
      return false;
    }

    const result = readPrintableInputLine(this.pendingInputLine, data);
    this.pendingInputLine = result.draft;
    if (!result.submitted) {
      return false;
    }

    if (this.mode === "new" && !this.firstSubmittedUserMessage) {
      this.firstSubmittedUserMessage = result.submitted;
    }

    if ((this.mode === "resume" || this.mode === "resumeLast") && !this.userRenamed && this.name === defaultSessionName(this.mode)) {
      this.latestSubmittedUserMessage = result.submitted;
    }

    if (!this.firstSubmittedUserMessage && !this.latestSubmittedUserMessage) {
      return false;
    }

    this.lastCodexThreadSyncAt = 0;
    this.startCodexThreadSync();
    return this.syncCodexThreadTitle({ force: true });
  }

  private markResumePickerActivity(data: string): boolean {
    if ((this.mode !== "resume" && this.mode !== "resumeLast") || this.codexThreadId || !hasLineSubmission(data)) {
      return false;
    }

    this.lastCodexThreadSyncAt = 0;
    return this.syncResumePickerSelectionFromHistory();
  }

  private syncResumePickerSelectionFromHistory(): boolean {
    if (!this.codexThreadStore) {
      return false;
    }

    const selectionText = extractResumePickerSelectionText(this.history);
    const selectedThread = selectionText ? this.codexThreadStore.findThreadInText(this.cwd, selectionText) : null;
    if (!selectedThread) {
      return false;
    }

    const previousName = this.name;
    const previousThreadId = this.codexThreadId;
    this.codexThreadId = selectedThread.id;
    if (!this.userRenamed && selectedThread.title) {
      this.name = selectedThread.title;
    }
    this.touch();
    return previousName !== this.name || previousThreadId !== this.codexThreadId;
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
    const thread = this.resolveCodexThread();

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

  private resolveCodexThread() {
    if (!this.codexThreadStore) {
      return null;
    }

    if (this.codexThreadId) {
      return this.codexThreadStore.getThread(this.codexThreadId);
    }

    if (this.mode === "new") {
      return this.firstSubmittedUserMessage
        ? this.codexThreadStore.findThreadByFirstUserMessage(this.cwd, this.createdAtMs, this.firstSubmittedUserMessage)
        : null;
    }

    if ((this.mode === "resume" || this.mode === "resumeLast") && !this.userRenamed && this.name === defaultSessionName(this.mode)) {
      return this.latestSubmittedUserMessage
        ? this.codexThreadStore.findThreadByRecentUserMessage(this.cwd, this.createdAtMs, this.latestSubmittedUserMessage)
        : null;
    }

    return null;
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

  list(options: ListOptions = {}): OpenCozySessionSummary[] {
    const sessions = Array.from(this.sessions.values());
    const explicitTabIds = new Set(options.tabIds ?? []);
    const visibleSessions = sessions.filter((session) => (
      (options.deviceId && session.deviceId === options.deviceId) || explicitTabIds.has(session.id)
    ));

    return visibleSessions
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

  attach(id: string, socket: WebSocket, options: AttachOptions = {}): boolean {
    const session = this.sessions.get(id);
    if (!session) {
      return false;
    }

    session.attach(socket, options);
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
