import { describe, expect, it, vi } from "vitest";
import {
  CodexAppServerPool,
  type CodexAppServerConnection,
} from "../src/harnesses/codex/appServerPool.js";

describe("Codex app-server pool", () => {
  it("keeps separate threads on their owning connections", async () => {
    const pool = new CodexAppServerPool(async () => fakeConnection());
    const first = await pool.acquire();
    const other = await pool.acquire();
    first.bindThread("first");
    other.bindThread("other");
    await first.release();
    await other.release();

    const resumed = await pool.acquire("first");
    expect(resumed.connection).toBe(first.connection);
    await expect(pool.acquire("first")).rejects.toThrow("active Run");
    const concurrent = await pool.acquire("other");
    expect(concurrent.connection).toBe(other.connection);
    resumed.release();
    concurrent.release();
    await pool.close();
  });

  it("does not lend an idle thread's writer to a newly created thread", async () => {
    const pool = new CodexAppServerPool(async () => fakeConnection());
    const first = await pool.acquire();
    first.bindThread("first");
    await first.release();
    const second = await pool.acquire();
    expect(second.connection).not.toBe(first.connection);
    second.bindThread("second");
    const concurrent = await pool.acquire("first");
    expect(concurrent.connection).toBe(first.connection);
    await second.release();
    await concurrent.release();
    await pool.close();
  });

  it.each(["failed", "evicted", "dead"])("waits for a %s writer process to exit before reacquiring its thread", async (reason) => {
    let finishClose!: () => void;
    const closing = new Promise<void>(resolve => { finishClose = resolve; });
    const connection = fakeConnection();
    connection.close = vi.fn(() => closing);
    const create = vi.fn().mockResolvedValueOnce(connection).mockImplementation(async () => fakeConnection());
    const pool = new CodexAppServerPool(create);
    const first = await pool.acquire("first");
    if (reason === "evicted") {
      const others = await Promise.all([pool.acquire("second"), pool.acquire("third")]);
      await Promise.all(others.map(lease => lease.release()));
    }
    if (reason === "dead") {
      await first.release();
      connection.isUsable = () => false;
    }
    const release = reason === "dead" ? undefined : first.release(reason !== "failed");
    const acquiring = pool.acquire("first");
    await Promise.resolve();
    expect(create).toHaveBeenCalledTimes(reason === "evicted" ? 3 : 1);
    finishClose();
    await release;
    const recovered = await acquiring;
    expect(recovered.connection).not.toBe(first.connection);
    await recovered.release();
    await pool.close();
  });

  it("rejects duplicate acquisition while a thread's connection is being created", async () => {
    let finishCreate!: (connection: CodexAppServerConnection) => void;
    const pool = new CodexAppServerPool(() => new Promise(resolve => { finishCreate = resolve; }));
    const first = pool.acquire("first");
    await expect(pool.acquire("first")).rejects.toThrow("already being acquired");
    finishCreate(fakeConnection());
    await (await first).release();
    await pool.close();
  });

  it("warms one connection and reuses it across turns", async () => {
    const connections: CodexAppServerConnection[] = [];
    const pool = new CodexAppServerPool(async () => {
      const connection = fakeConnection();
      connections.push(connection);
      return connection;
    });

    await pool.warm();
    const first = await pool.acquire();
    first.release();
    const second = await pool.acquire();
    second.release();

    expect(connections).toHaveLength(1);
    await pool.close();
    expect(connections[0]?.close).toHaveBeenCalledOnce();
  });

  it("discards a failed connection instead of returning it to the pool", async () => {
    const connections: CodexAppServerConnection[] = [];
    const pool = new CodexAppServerPool(async () => {
      const connection = fakeConnection();
      connections.push(connection);
      return connection;
    });

    const first = await pool.acquire();
    first.release(false);
    const second = await pool.acquire();
    second.release();

    expect(connections).toHaveLength(2);
    expect(connections[0]?.close).toHaveBeenCalledOnce();
    await pool.close();
  });

  it("discards an app-server connection that died while idle", async () => {
    const connections: Array<CodexAppServerConnection & { usable: boolean }> = [];
    const pool = new CodexAppServerPool(async () => {
      const connection = fakeConnection() as CodexAppServerConnection & { usable: boolean };
      connection.usable = true;
      connection.isUsable = () => connection.usable;
      connections.push(connection);
      return connection;
    });

    const first = await pool.acquire();
    first.release();
    connections[0]!.usable = false;

    const second = await pool.acquire();
    second.release();

    expect(connections).toHaveLength(2);
    expect(connections[0]?.close).toHaveBeenCalledOnce();
    await pool.close();
  });

  it("retains at most two idle connections without limiting active leases", async () => {
    const connections: CodexAppServerConnection[] = [];
    const pool = new CodexAppServerPool(async () => {
      const connection = fakeConnection();
      connections.push(connection);
      return connection;
    });

    const leases = await Promise.all([pool.acquire(), pool.acquire(), pool.acquire()]);
    leases.forEach((lease) => lease.release());

    expect(connections).toHaveLength(3);
    expect(connections[2]?.close).toHaveBeenCalledOnce();
    await pool.close();
  });

  it("closes a connection created while the pool is closing", async () => {
    let resolveConnection!: (connection: CodexAppServerConnection) => void;
    const created = new Promise<CodexAppServerConnection>((resolve) => { resolveConnection = resolve; });
    const pool = new CodexAppServerPool(async () => created);
    const acquiring = pool.acquire();
    await pool.close();
    const connection = fakeConnection();
    resolveConnection(connection);

    await expect(acquiring).rejects.toThrow("pool is closed");
    expect(connection.close).toHaveBeenCalledOnce();
  });
});

function fakeConnection(): CodexAppServerConnection {
  return {
    close: vi.fn(async () => undefined),
    async *notifications() {
      return;
    },
    notify: vi.fn(),
    request: async <T = unknown>() => ({} as T),
    respond: vi.fn(),
  };
}
