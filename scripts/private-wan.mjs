#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const envPath = path.join(projectRoot, ".env");
const command = process.argv[2] || "doctor";

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

function readAllowedHosts(value) {
  return Array.from(new Set(
    (value || "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean)
  ));
}

function findExecutable(name, extraPaths = []) {
  const result = spawnSync("sh", ["-lc", `command -v ${name}`], { encoding: "utf8" });
  const fromPath = result.status === 0 ? result.stdout.trim() : "";
  if (fromPath) {
    return fromPath;
  }

  return extraPaths.find((candidate) => existsSync(candidate)) || null;
}

function isLoopbackHost(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "127.0.0.1" || normalized === "localhost" || normalized === "::1" || normalized === "[::1]";
}

function localNetworkHints() {
  const names = new Set([os.hostname()]);
  const scutil = spawnSync("scutil", ["--get", "LocalHostName"], { encoding: "utf8" });
  if (scutil.status === 0 && scutil.stdout.trim()) {
    names.add(`${scutil.stdout.trim()}.local`);
  }

  const addresses = [];
  for (const entries of Object.values(os.networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === "IPv4" && !entry.internal) {
        addresses.push(entry.address);
      }
    }
  }

  return {
    names: Array.from(names).filter(Boolean),
    addresses
  };
}

function request(url, headers = {}) {
  return new Promise((resolve) => {
    const req = http.get(url, { headers, timeout: 1_500 }, (res) => {
      res.on("end", () => resolve({ ok: (res.statusCode || 0) >= 200 && (res.statusCode || 0) < 400, statusCode: res.statusCode || 0 }));
      res.resume();
    });

    req.on("timeout", () => {
      req.destroy();
      resolve({ ok: false, statusCode: 0 });
    });
    req.on("error", () => resolve({ ok: false, statusCode: 0 }));
  });
}

function run(executable, args) {
  const result = spawnSync(executable, args, {
    cwd: projectRoot,
    stdio: "inherit"
  });

  return result.status ?? 1;
}

function printCheck(ok, message) {
  console.log(`${ok ? "ok" : "warn"} - ${message}`);
}

function printSkipped(message) {
  console.log(`skip - ${message}`);
}

async function readState() {
  const fileEnv = readDotenv(envPath);
  const env = { ...process.env, ...fileEnv };
  const backendHost = env.OPENCOZY_HOST || "0.0.0.0";
  const backendPort = readPort(env.OPENCOZY_PORT, 8788);
  const frontendPort = readPort(env.OPENCOZY_FRONTEND_PORT, 5175);
  const allowedHosts = readAllowedHosts(env.OPENCOZY_ALLOWED_HOSTS);
  const tailscaleSocket = env.OPENCOZY_TAILSCALE_SOCKET || "";
  const tailscale = findExecutable("tailscale", [
    "/Applications/Tailscale.app/Contents/MacOS/Tailscale",
    "/Applications/Tailscale.app/Contents/MacOS/tailscale"
  ]);
  const hints = localNetworkHints();
  const canCheckLocalHttp = process.env.CODEX_SANDBOX_NETWORK_DISABLED !== "1";
  const backendHealth = canCheckLocalHttp ? await request(`http://127.0.0.1:${backendPort}/api/health`) : null;
  const frontendHealth = canCheckLocalHttp ? await request(`http://127.0.0.1:${frontendPort}/`) : null;

  return {
    allowedHosts,
    backendHealth,
    backendHost,
    backendPort,
    frontendHealth,
    frontendPort,
    hints,
    tailscale,
    tailscaleSocket
  };
}

function printSummary(state) {
  console.log("OpenCozy private WAN");
  console.log(`backend: ${state.backendHost}:${state.backendPort}`);
  console.log(`frontend: 0.0.0.0:${state.frontendPort}`);
  console.log(`allowed hosts: ${state.allowedHosts.length ? state.allowedHosts.join(", ") : "<none>"}`);
  console.log(`tailscale cli: ${state.tailscale || "<not found>"}`);
  console.log(`tailscale socket: ${state.tailscaleSocket || "<default>"}`);
  console.log("");

  printCheck(isLoopbackHost(state.backendHost), "backend should bind to 127.0.0.1 for Tailscale Serve");
  printCheck(state.allowedHosts.length > 0, "OPENCOZY_ALLOWED_HOSTS should include LAN and tailnet browser hostnames");
  printCheck(Boolean(state.tailscale), state.tailscale ? "Tailscale CLI is available" : "Tailscale CLI was not found");
  if (state.backendHealth) {
    printCheck(state.backendHealth.ok, `backend health on 127.0.0.1:${state.backendPort}`);
  } else {
    printSkipped("backend health check because Codex sandbox has network disabled");
  }
  if (state.frontendHealth) {
    printCheck(state.frontendHealth.ok, `frontend health on 127.0.0.1:${state.frontendPort}`);
  } else {
    printSkipped("frontend health check because Codex sandbox has network disabled");
  }

  if (state.hints.names.length || state.hints.addresses.length) {
    console.log("");
    console.log(`local host hints: ${[...state.hints.names, ...state.hints.addresses].join(", ")}`);
  }

  console.log("");
  console.log("serve command:");
  const socketArgs = state.tailscaleSocket ? ` --socket=${state.tailscaleSocket}` : "";
  console.log(`${state.tailscale || "tailscale"}${socketArgs} serve --bg --https=443 http://127.0.0.1:${state.frontendPort}`);
}

function tailscaleArgs(state, args) {
  return state.tailscaleSocket ? [`--socket=${state.tailscaleSocket}`, ...args] : args;
}

async function doctor() {
  const state = await readState();
  printSummary(state);
  if (state.tailscale) {
    console.log("");
    run(state.tailscale, tailscaleArgs(state, ["serve", "status"]));
  }
}

async function serve() {
  const state = await readState();
  printSummary(state);

  if (!state.tailscale) {
    console.error("\nTailscale CLI was not found. Install Tailscale on this Mac or put tailscale on PATH, then retry.");
    return 1;
  }

  if (!isLoopbackHost(state.backendHost)) {
    console.error("\nRefusing to start Tailscale Serve while OPENCOZY_HOST is not 127.0.0.1/localhost.");
    console.error("Update .env, then restart OpenCozy with explicit approval because restarting kills active Codex sessions.");
    return 1;
  }

  if (state.allowedHosts.length === 0) {
    console.error("\nRefusing to start Tailscale Serve without OPENCOZY_ALLOWED_HOSTS.");
    console.error("Add the LAN and tailnet browser hostnames to .env, then restart OpenCozy with explicit approval.");
    return 1;
  }

  console.log("");
  return run(state.tailscale, tailscaleArgs(state, ["serve", "--bg", "--https=443", `http://127.0.0.1:${state.frontendPort}`]));
}

async function status() {
  const state = await readState();
  printSummary(state);

  if (!state.tailscale) {
    return 1;
  }

  console.log("");
  const statusCode = run(state.tailscale, tailscaleArgs(state, ["status"]));
  console.log("");
  const serveCode = run(state.tailscale, tailscaleArgs(state, ["serve", "status"]));
  return statusCode === 0 && serveCode === 0 ? 0 : 1;
}

async function stop() {
  const state = await readState();
  printSummary(state);

  if (!state.tailscale) {
    console.error("\nTailscale CLI was not found. Nothing was changed.");
    return 1;
  }

  console.log("");
  return run(state.tailscale, tailscaleArgs(state, ["serve", "--https=443", "off"]));
}

if (!["doctor", "serve", "status", "stop"].includes(command)) {
  console.error("Usage: npm run private-wan:{doctor|serve|status|stop}");
  process.exitCode = 64;
} else {
  const exitCode = await ({ doctor, serve, status, stop })[command]();
  process.exitCode = exitCode || 0;
}
