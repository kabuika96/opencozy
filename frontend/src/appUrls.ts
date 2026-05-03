import type { AppShortcutInput } from "./types";

export function normalizeAppPath(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return "/";
  }

  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

export function buildLaunchUrl(input: Pick<AppShortcutInput, "protocol" | "host" | "port" | "path">): string {
  return `${input.protocol}://${input.host}:${input.port}${normalizeAppPath(input.path)}`;
}
