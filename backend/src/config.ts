import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadDotenv } from "dotenv";

const moduleDir = path.dirname(fileURLToPath(import.meta.url));
export const projectRoot = path.resolve(moduleDir, "..", "..");

loadDotenv({ path: path.join(projectRoot, ".env"), quiet: true });

function resolveProjectPath(value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(projectRoot, value);
}

function readPort(value: string | undefined): number {
  const parsed = Number(value ?? "8788");
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`Invalid OPENCOZY_PORT: ${value}`);
  }

  return parsed;
}

export type OpenCozyConfig = {
  host: string;
  port: number;
  dbPath: string;
  codexBin: string;
  defaultCodexCwd: string;
  codexStateDbPath?: string;
  allowedHosts?: string[];
  frontendPort?: number;
  tailscaleBin?: string;
  tailscaleSocket?: string;
};

export function readAllowedHosts(value: string | undefined): string[] {
  return Array.from(new Set(
    (value || "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean)
  ));
}

export function readConfig(): OpenCozyConfig {
  return {
    host: process.env.OPENCOZY_HOST?.trim() || "0.0.0.0",
    port: readPort(process.env.OPENCOZY_PORT),
    dbPath: resolveProjectPath(process.env.OPENCOZY_DB_PATH?.trim() || "data/opencozy.sqlite"),
    codexBin: process.env.OPENCOZY_CODEX_BIN?.trim() || "codex",
    defaultCodexCwd: process.env.OPENCOZY_CODEX_CWD?.trim() || homedir(),
    codexStateDbPath: process.env.OPENCOZY_CODEX_STATE_DB_PATH?.trim() || path.join(process.env.CODEX_HOME?.trim() || path.join(homedir(), ".codex"), "state_5.sqlite"),
    allowedHosts: readAllowedHosts(process.env.OPENCOZY_ALLOWED_HOSTS),
    frontendPort: readPort(process.env.OPENCOZY_FRONTEND_PORT),
    tailscaleBin: process.env.OPENCOZY_TAILSCALE_BIN?.trim() || "tailscale",
    tailscaleSocket: process.env.OPENCOZY_TAILSCALE_SOCKET?.trim() || undefined
  };
}
