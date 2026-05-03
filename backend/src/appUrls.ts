import type { AppShortcutInput } from "./types.js";

export function normalizeShortcutPath(value: unknown): string {
  if (typeof value !== "string") {
    return "/";
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "/";
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function buildShortcutUrl(shortcut: Pick<AppShortcutInput, "protocol" | "host" | "port" | "path">): string {
  return `${shortcut.protocol}://${shortcut.host}:${shortcut.port}${normalizeShortcutPath(shortcut.path)}`;
}
