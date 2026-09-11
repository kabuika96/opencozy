import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createRequire } from "node:module";
import readline from "node:readline";

export type AppServerRequestId = number | string;

export type AppServerMessage = {
  id?: AppServerRequestId;
  method?: string;
  params?: unknown;
};

type PendingRequest = {
  timeout: ReturnType<typeof setTimeout>;
  reject(error: unknown): void;
  resolve(value: unknown): void;
};

type NotificationWaiter = {
  resolve(value: IteratorResult<AppServerMessage>): void;
};

export type CodexAppServerConnection = {
  close(): Promise<void>;
  isUsable?(): boolean;
  notifications(signal?: AbortSignal): AsyncIterable<AppServerMessage>;
  notify(method: string, params?: unknown): void;
  request<T = unknown>(method: string, params: unknown): Promise<T>;
  respond(id: AppServerRequestId, result: unknown): Promise<void> | void;
};

export type CodexAppServerLease = {
  connection: CodexAppServerConnection;
  bindThread(threadId: string): void;
  release(reusable?: boolean): Promise<void> | void;
};

export type CodexAppServerPoolLike = {
  acquire(threadId?: string): Promise<CodexAppServerLease>;
  close(): Promise<void>;
  warm(): Promise<void>;
};

const requireFromHere = createRequire(import.meta.url);
const maxStderrCharacters = 64 * 1024;
const maxQueuedNotifications = 10_000;
const requestTimeoutMs = 30_000;
const maxIdleConnections = 2;

export class CodexAppServerPool implements CodexAppServerPoolLike {
  private readonly connections = new Set<CodexAppServerConnection>();
  private readonly idle: CodexAppServerConnection[] = [];
  private readonly owners = new Map<string, CodexAppServerConnection>();
  private readonly boundThreads = new WeakMap<CodexAppServerConnection, string>();
  private readonly acquiringThreads = new Set<string>();
  private readonly retiring = new Map<CodexAppServerConnection, Promise<void>>();
  private closed = false;
  private warming: Promise<void> | null = null;

  constructor(
    private readonly createConnection: () => Promise<CodexAppServerConnection> = createCodexAppServerConnection,
  ) {}

  async warm(): Promise<void> {
    if (this.closed || this.connections.size > 0) {
      return;
    }
    if (!this.warming) {
      this.warming = this.acquire().then((lease) => lease.release()).finally(() => {
        this.warming = null;
      });
    }
    await this.warming;
  }

  // One main thread per process: an idle Codex thread still holds its writer
  // lock, so lending its process to another thread breaks concurrent follow-ups.
  async acquire(threadId?: string): Promise<CodexAppServerLease> {
    if (this.closed) throw new Error("Codex app-server pool is closed");
    if (threadId && this.acquiringThreads.has(threadId)) throw new Error("Codex thread is already being acquired");
    if (threadId) this.acquiringThreads.add(threadId);
    try {
      let connection: CodexAppServerConnection | undefined;
      if (threadId) {
        const owner = this.owners.get(threadId);
        if (owner) {
          const closing = this.retiring.get(owner);
          if (closing) {
            await closing;
          } else if (owner.isUsable?.() === false) {
            const index = this.idle.indexOf(owner);
            if (index >= 0) this.idle.splice(index, 1);
            await this.retire(owner);
          } else {
            const index = this.idle.indexOf(owner);
            if (index < 0) throw new Error("Codex thread already has an active Run");
            connection = this.idle.splice(index, 1)[0];
          }
        }
      }
      // Only the prewarmed, unbound process can serve a different/new thread.
      while (!connection) {
        const index = this.idle.findIndex(candidate => !this.boundThreads.has(candidate));
        if (index < 0) break;
        const candidate = this.idle.splice(index, 1)[0]!;
        if (candidate.isUsable?.() !== false) connection = candidate;
        else await this.retire(candidate);
      }
      connection ??= await this.createConnection();
      if (this.closed) {
        await connection.close();
        throw new Error("Codex app-server pool is closed");
      }
      this.connections.add(connection);
      let released: Promise<void> | undefined;
      const leasedConnection = connection;
      const bindThread = (id: string) => {
        const bound = this.boundThreads.get(leasedConnection);
        const owner = this.owners.get(id);
        if ((bound && bound !== id) || (owner && owner !== leasedConnection)) {
          throw new Error("Codex thread already belongs to another connection");
        }
        this.boundThreads.set(leasedConnection, id);
        this.owners.set(id, leasedConnection);
      };
      if (threadId) bindThread(threadId);
      return {
        connection: leasedConnection,
        bindThread,
        release: (reusable = true) => {
          if (released) return released;
          if (!reusable || this.closed || leasedConnection.isUsable?.() === false || this.idle.length >= maxIdleConnections) {
            released = this.retire(leasedConnection);
          } else {
            this.idle.push(leasedConnection);
            released = Promise.resolve();
          }
          return released;
        },
      };
    } finally {
      if (threadId) this.acquiringThreads.delete(threadId);
    }
  }

  private retire(connection: CodexAppServerConnection): Promise<void> {
    const existing = this.retiring.get(connection);
    if (existing) return existing;
    // Keep ownership until process exit, including while another acquire waits.
    const closing = connection.close().then(() => {
      this.connections.delete(connection);
      const threadId = this.boundThreads.get(connection);
      if (threadId) this.owners.delete(threadId);
      this.boundThreads.delete(connection);
      this.retiring.delete(connection);
    });
    this.retiring.set(connection, closing);
    return closing;
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    const connections = Array.from(this.connections);
    this.connections.clear();
    this.idle.length = 0;
    await Promise.allSettled(connections.map((connection) => this.retire(connection)));
  }
}

class StdioCodexAppServerConnection implements CodexAppServerConnection {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly notificationQueue: AppServerMessage[] = [];
  private readonly notificationWaiters: NotificationWaiter[] = [];
  private nextId = 0;
  private stderr = "";
  private closed = false;
  private closePromise: Promise<void> | null = null;

  constructor() {
    const command = codexCliCommand();
    this.child = spawn(command.command, [...command.args, "app-server", "--listen", "stdio://"]);
    this.child.stderr.on("data", (chunk: Buffer) => {
      this.stderr = `${this.stderr}${chunk.toString("utf8")}`.slice(-maxStderrCharacters);
    });
    this.child.stdin.on("error", (error) => this.finishClose(error));
    this.child.once("error", (error) => this.finishClose(error));
    this.child.once("exit", (code, signal) => {
      if (this.closed) {
        this.finishClose();
        return;
      }
      const detail = signal ? `signal ${signal}` : `code ${code ?? 1}`;
      this.finishClose(new Error(`Codex app-server exited with ${detail}: ${this.stderr}`));
    });

    const lines = readline.createInterface({
      crlfDelay: Infinity,
      input: this.child.stdout,
    });
    lines.on("line", (line) => this.handleLine(line));
    lines.once("close", () => {
      if (!this.closed) {
        this.finishClose(new Error(`Codex app-server stream closed: ${this.stderr}`));
      }
    });
  }

  async initialize(): Promise<void> {
    await this.request("initialize", {
      capabilities: {
        experimentalApi: true,
      },
      clientInfo: {
        name: "liteharness",
        title: "Opencozy",
        version: "0.1.0",
      },
    });
    this.notify("initialized", {});
  }

  request<T = unknown>(method: string, params: unknown): Promise<T> {
    if (this.closed) {
      return Promise.reject(new Error("Codex app-server is closed"));
    }
    const id = `liteharness-${++this.nextId}`;
    return new Promise<T>((resolve, reject) => {
      const key = requestKey(id);
      const timeout = setTimeout(() => {
        const pending = this.pending.get(key);
        if (!pending) return;
        this.pending.delete(key);
        pending.reject(new Error(`Codex app-server request timed out: ${method}`));
      }, requestTimeoutMs);
      this.pending.set(requestKey(id), {
        timeout,
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        },
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value as T);
        },
      });
      this.write({ id, method, params }, (error) => {
        if (!error) {
          return;
        }
        this.pending.delete(key);
        clearTimeout(timeout);
        reject(error);
      });
    });
  }

  notify(method: string, params?: unknown): void {
    if (this.closed) {
      return;
    }
    this.write({ method, ...(params === undefined ? {} : { params }) });
  }

  respond(id: AppServerRequestId, result: unknown): Promise<void> {
    if (this.closed) {
      return Promise.reject(new Error("Codex app-server is closed"));
    }
    return this.writeAsync({ id, result });
  }

  isUsable(): boolean {
    return !this.closed;
  }

  async *notifications(signal?: AbortSignal): AsyncIterable<AppServerMessage> {
    while (!this.closed && !signal?.aborted) {
      const queued = this.notificationQueue.shift();
      if (queued) {
        yield queued;
        continue;
      }

      const result = await new Promise<IteratorResult<AppServerMessage>>((resolve) => {
        const waiter: NotificationWaiter = { resolve };
        const abort = () => {
          signal?.removeEventListener("abort", abort);
          const index = this.notificationWaiters.indexOf(waiter);
          if (index >= 0) {
            this.notificationWaiters.splice(index, 1);
          }
          resolve({ done: true, value: undefined });
        };
        if (signal?.aborted) {
          resolve({ done: true, value: undefined });
          return;
        }
        signal?.addEventListener("abort", abort, { once: true });
        waiter.resolve = (value) => {
          signal?.removeEventListener("abort", abort);
          resolve(value);
        };
        this.notificationWaiters.push(waiter);
      });
      if (result.done) {
        return;
      }
      yield result.value;
    }
  }

  close(): Promise<void> {
    if (this.closePromise) {
      return this.closePromise;
    }
    this.closePromise = new Promise<void>((resolve) => {
      if (this.child.exitCode !== null || this.child.signalCode !== null) {
        this.finishClose();
        resolve();
        return;
      }
      this.child.once("exit", () => resolve());
      this.finishClose();
      this.child.kill();
    });
    return this.closePromise;
  }

  private write(message: unknown, callback?: (error?: Error | null) => void): void {
    try {
      this.child.stdin.write(`${JSON.stringify(message)}\n`, (error) => {
        if (error) this.finishClose(error);
        callback?.(error);
      });
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      this.finishClose(failure);
      callback?.(failure);
    }
  }

  private writeAsync(message: unknown): Promise<void> {
    return new Promise((resolve, reject) => {
      this.write(message, (error) => error ? reject(error) : resolve());
    });
  }

  private handleLine(line: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    const message = readRecord(parsed);
    if (!message) {
      return;
    }
    const id = readRequestId(message.id);
    if (id !== null) {
      const pending = this.pending.get(requestKey(id));
      if (pending) {
        this.pending.delete(requestKey(id));
        const error = readRecord(message.error);
        if (error) {
          pending.reject(new Error(readString(error.message) ?? `Codex app-server request ${String(id)} failed`));
          return;
        }
        pending.resolve(message.result);
        return;
      }
    }
    const method = readString(message.method);
    if (!method) {
      return;
    }
    this.pushNotification({
      ...(id === null ? {} : { id }),
      method,
      params: message.params,
    });
  }

  private pushNotification(notification: AppServerMessage): void {
    const waiter = this.notificationWaiters.shift();
    if (waiter) {
      waiter.resolve({ done: false, value: notification });
      return;
    }
    if (this.notificationQueue.length >= maxQueuedNotifications) {
      this.finishClose(new Error("Codex app-server notification queue exceeded its safety limit"));
      return;
    }
    this.notificationQueue.push(notification);
  }

  private finishClose(error?: unknown): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.notificationQueue.length = 0;
    for (const pending of this.pending.values()) {
      pending.reject(error ?? new Error("Codex app-server closed"));
    }
    this.pending.clear();
    while (this.notificationWaiters.length > 0) {
      this.notificationWaiters.shift()?.resolve({ done: true, value: undefined });
    }
  }
}

async function createCodexAppServerConnection(): Promise<CodexAppServerConnection> {
  const connection = new StdioCodexAppServerConnection();
  try {
    await connection.initialize();
    return connection;
  } catch (error) {
    await connection.close();
    throw error;
  }
}

function codexCliCommand(): { args: string[]; command: string } {
  const override = process.env.LITEHARNESS_CODEX_BIN?.trim();
  if (override) {
    return { args: [], command: override };
  }
  try {
    return {
      args: [requireFromHere.resolve("@openai/codex/bin/codex.js")],
      command: process.execPath,
    };
  } catch {
    return { args: [], command: "codex" };
  }
}

function requestKey(id: AppServerRequestId): string {
  return `${typeof id}:${String(id)}`;
}

function readRequestId(value: unknown): AppServerRequestId | null {
  return typeof value === "string" || typeof value === "number" ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}
