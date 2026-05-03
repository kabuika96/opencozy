import { normalizeShortcutPath } from "./appUrls.js";
import type { AppShortcutInput, OpenCozySessionMode, ShortcutProtocol } from "./types.js";

const SESSION_NAME_MAX_LENGTH = 80;

type ParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; message: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseString(value: unknown, field: string): ParseResult<string> {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, message: `${field} is required` };
  }

  return { ok: true, value: value.trim() };
}

function parseProtocol(value: unknown): ParseResult<ShortcutProtocol> {
  if (value === "http" || value === "https") {
    return { ok: true, value };
  }

  return { ok: false, message: "protocol must be http or https" };
}

function parsePort(value: unknown): ParseResult<number> {
  const numberValue = typeof value === "string" ? Number(value) : typeof value === "number" ? value : Number.NaN;
  if (!Number.isInteger(numberValue) || numberValue < 1 || numberValue > 65535) {
    return { ok: false, message: "port must be an integer from 1 to 65535" };
  }

  return { ok: true, value: numberValue };
}

export function parseAppShortcutInput(body: unknown): ParseResult<AppShortcutInput> {
  if (!isRecord(body)) {
    return { ok: false, message: "Expected a JSON object" };
  }

  const name = parseString(body.name, "name");
  if (!name.ok) return name;

  const protocol = parseProtocol(body.protocol);
  if (!protocol.ok) return protocol;

  const host = parseString(body.host, "host");
  if (!host.ok) return host;

  const port = parsePort(body.port);
  if (!port.ok) return port;

  return {
    ok: true,
    value: {
      name: name.value,
      protocol: protocol.value,
      host: host.value,
      port: port.value,
      path: normalizeShortcutPath(body.path)
    }
  };
}

export type CreateOpenCozySessionInput = {
  mode: OpenCozySessionMode;
  name?: string;
  cwd?: string;
};

export type RenameOpenCozySessionInput = {
  name: string;
};

export function parseCreateOpenCozySessionInput(body: unknown): ParseResult<CreateOpenCozySessionInput> {
  if (!isRecord(body)) {
    return { ok: false, message: "Expected a JSON object" };
  }

  if (body.mode !== "new" && body.mode !== "resume" && body.mode !== "resumeLast") {
    return { ok: false, message: "mode must be new, resume, or resumeLast" };
  }

  if (body.cwd !== undefined && (typeof body.cwd !== "string" || body.cwd.trim().length === 0)) {
    return { ok: false, message: "cwd must be a non-empty string when provided" };
  }

  if (body.name !== undefined) {
    if (typeof body.name !== "string" || body.name.trim().length === 0) {
      return { ok: false, message: "name must be a non-empty string when provided" };
    }

    if (body.name.trim().length > SESSION_NAME_MAX_LENGTH) {
      return { ok: false, message: `name must be ${SESSION_NAME_MAX_LENGTH} characters or fewer` };
    }
  }

  return {
    ok: true,
    value: {
      mode: body.mode,
      name: typeof body.name === "string" ? body.name.trim() : undefined,
      cwd: typeof body.cwd === "string" ? body.cwd.trim() : undefined
    }
  };
}

export function parseRenameOpenCozySessionInput(body: unknown): ParseResult<RenameOpenCozySessionInput> {
  if (!isRecord(body)) {
    return { ok: false, message: "Expected a JSON object" };
  }

  const name = parseString(body.name, "name");
  if (!name.ok) {
    return name;
  }

  if (name.value.length > SESSION_NAME_MAX_LENGTH) {
    return { ok: false, message: `name must be ${SESSION_NAME_MAX_LENGTH} characters or fewer` };
  }

  return { ok: true, value: { name: name.value } };
}
