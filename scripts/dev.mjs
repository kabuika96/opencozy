import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const runtimeEnv = { ...process.env, ...readDotenv(path.join(projectRoot, ".env")) };

function readDotenv(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const values = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(trimmed);
    if (!match) {
      continue;
    }
    const [, key, rawValue] = match;
    values[key] = rawValue.replace(/^["']|["']$/g, "");
  }
  return values;
}

const processes = [
  spawn("npm", ["run", "dev", "--workspace", "@opencozy/backend"], {
    env: runtimeEnv,
    stdio: "inherit",
  }),
  spawn("npm", ["run", "dev", "--workspace", "@opencozy/frontend"], {
    env: runtimeEnv,
    stdio: "inherit",
  }),
];

let stopping = false;

function stopAll(signal = "SIGTERM") {
  if (stopping) {
    return;
  }
  stopping = true;
  for (const child of processes) {
    if (!child.killed) {
      child.kill(signal);
    }
  }
}

for (const child of processes) {
  child.on("exit", (code) => {
    if (!stopping && code !== 0) {
      stopAll();
      process.exitCode = code ?? 1;
    }
  });
}

process.on("SIGINT", () => {
  stopAll("SIGINT");
});
process.on("SIGTERM", () => {
  stopAll("SIGTERM");
});
