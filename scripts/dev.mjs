#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");

function readDotenv(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const result = {};
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) {
      continue;
    }

    const [, key, rawValue] = match;
    result[key] = rawValue.replace(/^["']|["']$/g, "");
  }

  return result;
}

function readPort(value, fallback) {
  const parsed = Number(value || fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid port: ${value}`);
  }

  return parsed;
}

function canListen(port, host = "0.0.0.0") {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.listen({ host, port }, () => {
      server.close(() => resolve(true));
    });
  });
}

async function findFreePort(preferredPort, reservedPorts = new Set()) {
  for (let port = preferredPort; port < preferredPort + 100; port += 1) {
    if (reservedPorts.has(port)) {
      continue;
    }

    if (await canListen(port)) {
      return port;
    }
  }

  throw new Error(`No free port found from ${preferredPort} to ${preferredPort + 99}`);
}

function start(name, args, env) {
  const child = spawn("npm", args, {
    cwd: projectRoot,
    env,
    stdio: "inherit"
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    for (const processToStop of children) {
      if (processToStop !== child && !processToStop.killed) {
        processToStop.kill("SIGTERM");
      }
    }

    const reason = signal || code;
    console.error(`${name} exited: ${reason}`);
    process.exitCode = typeof code === "number" ? code : 1;
  });

  children.push(child);
}

const fileEnv = readDotenv(path.join(projectRoot, ".env"));
const baseEnv = { ...fileEnv, ...process.env };
const backendPreferredPort = readPort(baseEnv.OPENCOZY_PORT, 8788);
const backendPort = await findFreePort(backendPreferredPort);
const frontendPreferredPort = readPort(baseEnv.OPENCOZY_FRONTEND_PORT, 5175);
const frontendPort = await findFreePort(frontendPreferredPort, new Set([backendPort]));
const runtimeEnv = {
  ...baseEnv,
  OPENCOZY_HOST: baseEnv.OPENCOZY_HOST || "0.0.0.0",
  OPENCOZY_PORT: String(backendPort),
  OPENCOZY_FRONTEND_PORT: String(frontendPort)
};
const children = [];
let shuttingDown = false;

if (backendPort !== backendPreferredPort) {
  console.log(`Backend port ${backendPreferredPort} is busy; using ${backendPort}.`);
}

if (frontendPort !== frontendPreferredPort) {
  console.log(`Frontend port ${frontendPreferredPort} is busy; using ${frontendPort}.`);
}

console.log(`OpenCozy backend: http://127.0.0.1:${backendPort}`);
console.log(`OpenCozy frontend: http://127.0.0.1:${frontendPort}`);

process.on("SIGINT", () => {
  shuttingDown = true;
  for (const child of children) {
    child.kill("SIGINT");
  }
});

process.on("SIGTERM", () => {
  shuttingDown = true;
  for (const child of children) {
    child.kill("SIGTERM");
  }
});

start("backend", ["run", "dev", "-w", "backend"], runtimeEnv);
start("frontend", ["run", "dev", "-w", "frontend"], runtimeEnv);
