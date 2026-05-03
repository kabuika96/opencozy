import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";

export type CodexCapabilities = {
  installed: boolean;
  command: string;
  path: string | null;
  version: string | null;
  resumeListSupported: boolean;
  resumeListReason: string;
};

export type CodexLaunchCommand = {
  command: string;
  argsPrefix: string[];
  displayPath: string | null;
};

function readCommand(command: string, args: string[]): string | null {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return null;
  }
}

export function resolveCodexLaunch(codexBin: string): CodexLaunchCommand {
  const candidate = path.isAbsolute(codexBin) ? codexBin : readCommand("/usr/bin/which", [codexBin]);
  if (!candidate) {
    return {
      command: codexBin,
      argsPrefix: [],
      displayPath: null
    };
  }

  const realPath = realpathSync(candidate);
  if (realPath.endsWith(".js")) {
    return {
      command: process.execPath,
      argsPrefix: [realPath],
      displayPath: candidate
    };
  }

  return {
    command: realPath,
    argsPrefix: [],
    displayPath: candidate
  };
}

export function getCodexCapabilities(codexBin: string): CodexCapabilities {
  const launch = resolveCodexLaunch(codexBin);
  const version = readCommand(launch.command, [...launch.argsPrefix, "--version"]);
  const resumeHelp = readCommand(launch.command, [...launch.argsPrefix, "resume", "--help"]);
  const resumeListSupported = Boolean(resumeHelp && /--(json|format)\b/.test(resumeHelp));

  return {
    installed: Boolean(launch.displayPath || version),
    command: codexBin,
    path: launch.displayPath,
    version,
    resumeListSupported,
    resumeListReason: resumeListSupported
      ? "Installed Codex CLI appears to expose a machine-readable resume list option."
      : "Installed Codex CLI does not expose a stable machine-readable resume list; use the Resume Picker."
  };
}
