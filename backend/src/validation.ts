import { normalizeShortcutPath } from "./appUrls.js";
import type {
  AppShortcutInput,
  OpenCozySessionMode,
  PreviewCommandInput,
  PreviewDependencyServiceInput,
  PreviewManifestInput,
  PreviewManifestStatus,
  PreviewPublishedOriginInput,
  ShortcutProtocol,
  WiredPreviewInput
} from "./types.js";

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

function rejectUnknownFields(record: Record<string, unknown>, allowedFields: string[], field: string): ParseResult<void> {
  const allowed = new Set(allowedFields);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) {
      return { ok: false, message: `${field}.${key} is not allowed` };
    }
  }

  return { ok: true, value: undefined };
}

function parseOptionalString(value: unknown, fallback: string): ParseResult<string> {
  if (value === undefined || value === null) {
    return { ok: true, value: fallback };
  }

  if (typeof value !== "string") {
    return { ok: false, message: "Expected a string" };
  }

  const trimmed = value.trim();
  return { ok: true, value: trimmed || fallback };
}

function normalizePreviewUrl(value: string): ParseResult<string> {
  try {
    const url = new URL(/^[a-z][a-z\d+\-.]*:\/\//i.test(value) ? value : `http://${value}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { ok: false, message: "url must use http or https" };
    }

    return { ok: true, value: url.href };
  } catch {
    return { ok: false, message: "url must be a valid http or https URL" };
  }
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

function parsePreviewTarget(value: unknown, strict: boolean): ParseResult<{ name: string; url: string }> {
  if (!isRecord(value)) {
    return { ok: false, message: "target is required" };
  }

  if (strict) {
    const unknown = rejectUnknownFields(value, ["name", "url"], "target");
    if (!unknown.ok) return unknown;
  }

  const targetName = parseOptionalString(value.name, "App");
  if (!targetName.ok) return { ok: false, message: `target.name: ${targetName.message}` };

  const rawTargetUrl = parseString(value.url, "target.url");
  if (!rawTargetUrl.ok) return rawTargetUrl;

  const targetUrl = normalizePreviewUrl(rawTargetUrl.value);
  if (!targetUrl.ok) return targetUrl;

  return {
    ok: true,
    value: {
      name: targetName.value,
      url: targetUrl.value
    }
  };
}

function parseDependencyServices(value: unknown, strict = false): ParseResult<PreviewDependencyServiceInput[]> {
  if (value === undefined) {
    return { ok: true, value: [] };
  }

  if (!Array.isArray(value)) {
    return { ok: false, message: "dependencyServices must be an array" };
  }

  const services: PreviewDependencyServiceInput[] = [];
  for (const [index, service] of value.entries()) {
    if (!isRecord(service)) {
      return { ok: false, message: `dependencyServices[${index}] must be an object` };
    }

    if (strict) {
      const unknown = rejectUnknownFields(service, ["name", "url", "browserDirect"], `dependencyServices[${index}]`);
      if (!unknown.ok) return unknown;
    }

    const name = parseString(service.name, `dependencyServices[${index}].name`);
    if (!name.ok) return name;

    const rawUrl = parseString(service.url, `dependencyServices[${index}].url`);
    if (!rawUrl.ok) return rawUrl;

    const url = normalizePreviewUrl(rawUrl.value);
    if (!url.ok) return url;

    services.push({
      name: name.value,
      url: url.value,
      browserDirect: service.browserDirect === true
    });
  }

  return { ok: true, value: services };
}

function parsePreviewCommands(value: unknown, strict = false): ParseResult<PreviewCommandInput[]> {
  if (value === undefined) {
    return { ok: true, value: [] };
  }

  if (!Array.isArray(value)) {
    return { ok: false, message: "commands must be an array" };
  }

  const commands: PreviewCommandInput[] = [];
  for (const [index, command] of value.entries()) {
    if (!isRecord(command)) {
      return { ok: false, message: `commands[${index}] must be an object` };
    }

    if (strict) {
      const unknown = rejectUnknownFields(command, ["label", "cwd", "command"], `commands[${index}]`);
      if (!unknown.ok) return unknown;
    }

    const label = parseString(command.label, `commands[${index}].label`);
    if (!label.ok) return label;

    const cwd = parseString(command.cwd, `commands[${index}].cwd`);
    if (!cwd.ok) return cwd;

    const commandText = parseString(command.command, `commands[${index}].command`);
    if (!commandText.ok) return commandText;

    commands.push({ label: label.value, cwd: cwd.value, command: commandText.value });
  }

  return { ok: true, value: commands };
}

function parsePublishedOrigins(value: unknown, strict = false): ParseResult<PreviewPublishedOriginInput[]> {
  if (value === undefined) {
    return { ok: true, value: [] };
  }

  if (!Array.isArray(value)) {
    return { ok: false, message: "requestedPublishedOrigins must be an array" };
  }

  const origins: PreviewPublishedOriginInput[] = [];
  for (const [index, origin] of value.entries()) {
    if (!isRecord(origin)) {
      return { ok: false, message: `requestedPublishedOrigins[${index}] must be an object` };
    }

    if (strict) {
      const unknown = rejectUnknownFields(origin, ["name", "url"], `requestedPublishedOrigins[${index}]`);
      if (!unknown.ok) return unknown;
    }

    const name = parseString(origin.name, `requestedPublishedOrigins[${index}].name`);
    if (!name.ok) return name;

    const rawUrl = parseString(origin.url, `requestedPublishedOrigins[${index}].url`);
    if (!rawUrl.ok) return rawUrl;

    const url = normalizePreviewUrl(rawUrl.value);
    if (!url.ok) return url;

    origins.push({ name: name.value, url: url.value });
  }

  return { ok: true, value: origins };
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

export function parseWiredPreviewInput(body: unknown): ParseResult<WiredPreviewInput> {
  if (!isRecord(body)) {
    return { ok: false, message: "Expected a JSON object" };
  }

  const name = parseString(body.name, "name");
  if (!name.ok) return name;

  const projectDirectory = parseString(body.projectDirectory, "projectDirectory");
  if (!projectDirectory.ok) return projectDirectory;

  const target = parsePreviewTarget(body.target, false);
  if (!target.ok) return target;

  const dependencyServices = parseDependencyServices(body.dependencyServices);
  if (!dependencyServices.ok) return dependencyServices;

  const commands = parsePreviewCommands(body.commands);
  if (!commands.ok) return commands;

  const requestedPublishedOrigins = parsePublishedOrigins(body.requestedPublishedOrigins);
  if (!requestedPublishedOrigins.ok) return requestedPublishedOrigins;

  return {
    ok: true,
    value: {
      name: name.value,
      projectDirectory: projectDirectory.value,
      target: target.value,
      dependencyServices: dependencyServices.value,
      commands: commands.value,
      requestedPublishedOrigins: requestedPublishedOrigins.value
    }
  };
}

export function parsePreviewManifestInput(body: unknown): ParseResult<PreviewManifestInput> {
  if (!isRecord(body)) {
    return { ok: false, message: "Expected a JSON object" };
  }

  const unknown = rejectUnknownFields(
    body,
    ["wiredPreviewId", "wiringSessionId", "name", "projectDirectory", "target", "dependencyServices", "commands", "requestedPublishedOrigins"],
    "manifest"
  );
  if (!unknown.ok) return unknown;

  const name = parseString(body.name, "name");
  if (!name.ok) return name;

  const projectDirectory = parseString(body.projectDirectory, "projectDirectory");
  if (!projectDirectory.ok) return projectDirectory;

  const target = parsePreviewTarget(body.target, true);
  if (!target.ok) return target;

  const dependencyServices = parseDependencyServices(body.dependencyServices, true);
  if (!dependencyServices.ok) return dependencyServices;

  const commands = parsePreviewCommands(body.commands, true);
  if (!commands.ok) return commands;

  const requestedPublishedOrigins = parsePublishedOrigins(body.requestedPublishedOrigins, true);
  if (!requestedPublishedOrigins.ok) return requestedPublishedOrigins;

  if (body.wiredPreviewId !== undefined && (typeof body.wiredPreviewId !== "string" || body.wiredPreviewId.trim().length === 0)) {
    return { ok: false, message: "wiredPreviewId must be a non-empty string when provided" };
  }

  if (body.wiringSessionId !== undefined && (typeof body.wiringSessionId !== "string" || body.wiringSessionId.trim().length === 0)) {
    return { ok: false, message: "wiringSessionId must be a non-empty string when provided" };
  }

  return {
    ok: true,
    value: {
      ...(typeof body.wiredPreviewId === "string" ? { wiredPreviewId: body.wiredPreviewId.trim() } : {}),
      ...(typeof body.wiringSessionId === "string" ? { wiringSessionId: body.wiringSessionId.trim() } : {}),
      name: name.value,
      projectDirectory: projectDirectory.value,
      target: target.value,
      dependencyServices: dependencyServices.value,
      commands: commands.value,
      requestedPublishedOrigins: requestedPublishedOrigins.value
    }
  };
}

export type CreateOpenCozySessionInput = {
  mode: OpenCozySessionMode;
  codexThreadId?: string;
  deviceId?: string;
  name?: string;
  cwd?: string;
};

export type RenameOpenCozySessionInput = {
  name: string;
};

export type AttachWiredPreviewInput = {
  wiredPreviewId: string;
};

export type ApprovePreviewManifestInput = {
  name: string;
};

export type LaunchPreviewWiringSessionInput = {
  deviceId?: string;
  projectSearchBrief: string;
  wiredPreviewId?: string;
};

export type PublishPreviewOriginInput = {
  source: "target" | "dependencyService" | "browserDirectDependencyServices";
  dependencyServiceIndex?: number;
  httpsPort?: number;
};

export function parsePreviewManifestStatus(value: unknown): ParseResult<PreviewManifestStatus | undefined> {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }

  if (value === "pending" || value === "approved") {
    return { ok: true, value };
  }

  return { ok: false, message: "status must be pending or approved" };
}

export function parseApprovePreviewManifestInput(body: unknown): ParseResult<ApprovePreviewManifestInput> {
  if (!isRecord(body)) {
    return { ok: false, message: "Expected a JSON object" };
  }

  const unknown = rejectUnknownFields(body, ["name"], "approval");
  if (!unknown.ok) return unknown;

  const name = parseString(body.name, "name");
  if (!name.ok) return name;

  return { ok: true, value: { name: name.value } };
}

export function parseLaunchPreviewWiringSessionInput(body: unknown): ParseResult<LaunchPreviewWiringSessionInput> {
  if (!isRecord(body)) {
    return { ok: false, message: "Expected a JSON object" };
  }

  const unknown = rejectUnknownFields(body, ["deviceId", "projectSearchBrief", "wiredPreviewId"], "wiringSession");
  if (!unknown.ok) return unknown;

  const projectSearchBrief = parseString(body.projectSearchBrief, "projectSearchBrief");
  if (!projectSearchBrief.ok) return projectSearchBrief;

  if (body.deviceId !== undefined && (typeof body.deviceId !== "string" || body.deviceId.trim().length === 0)) {
    return { ok: false, message: "deviceId must be a non-empty string when provided" };
  }

  if (body.wiredPreviewId !== undefined && (typeof body.wiredPreviewId !== "string" || body.wiredPreviewId.trim().length === 0)) {
    return { ok: false, message: "wiredPreviewId must be a non-empty string when provided" };
  }

  return {
    ok: true,
    value: {
      projectSearchBrief: projectSearchBrief.value,
      ...(typeof body.deviceId === "string" ? { deviceId: body.deviceId.trim() } : {}),
      ...(typeof body.wiredPreviewId === "string" ? { wiredPreviewId: body.wiredPreviewId.trim() } : {})
    }
  };
}

export function parsePublishPreviewOriginInput(body: unknown): ParseResult<PublishPreviewOriginInput> {
  if (body === undefined || body === null) {
    return { ok: true, value: { source: "target" } };
  }

  if (!isRecord(body)) {
    return { ok: false, message: "Expected a JSON object" };
  }

  const unknown = rejectUnknownFields(body, ["source", "dependencyServiceIndex", "httpsPort"], "publishOrigin");
  if (!unknown.ok) return unknown;

  const source = body.source ?? "target";
  if (source !== "target" && source !== "dependencyService" && source !== "browserDirectDependencyServices") {
    return { ok: false, message: "source must be target, dependencyService, or browserDirectDependencyServices" };
  }

  let dependencyServiceIndex: number | undefined;
  if (body.dependencyServiceIndex !== undefined) {
    const parsedIndex = typeof body.dependencyServiceIndex === "number" ? body.dependencyServiceIndex : Number.NaN;
    if (!Number.isInteger(parsedIndex) || parsedIndex < 0) {
      return { ok: false, message: "dependencyServiceIndex must be a non-negative integer" };
    }
    dependencyServiceIndex = parsedIndex;
  }

  if (source === "dependencyService" && dependencyServiceIndex === undefined) {
    return { ok: false, message: "dependencyServiceIndex is required for dependencyService publishing" };
  }

  if (source !== "dependencyService" && dependencyServiceIndex !== undefined) {
    return { ok: false, message: "dependencyServiceIndex is only allowed for dependencyService publishing" };
  }

  if (body.httpsPort === undefined) {
    return {
      ok: true,
      value: {
        source,
        ...(dependencyServiceIndex !== undefined ? { dependencyServiceIndex } : {})
      }
    };
  }

  const httpsPort = parsePort(body.httpsPort);
  if (!httpsPort.ok) return { ok: false, message: httpsPort.message };

  return {
    ok: true,
    value: {
      source: "target",
      ...(source !== "target" ? { source } : {}),
      ...(dependencyServiceIndex !== undefined ? { dependencyServiceIndex } : {}),
      httpsPort: httpsPort.value
    }
  };
}

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

  if (body.codexThreadId !== undefined && (typeof body.codexThreadId !== "string" || body.codexThreadId.trim().length === 0)) {
    return { ok: false, message: "codexThreadId must be a non-empty string when provided" };
  }

  if (body.deviceId !== undefined && (typeof body.deviceId !== "string" || body.deviceId.trim().length === 0)) {
    return { ok: false, message: "deviceId must be a non-empty string when provided" };
  }

  return {
    ok: true,
    value: {
      mode: body.mode,
      codexThreadId: typeof body.codexThreadId === "string" ? body.codexThreadId.trim() : undefined,
      deviceId: typeof body.deviceId === "string" ? body.deviceId.trim() : undefined,
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

export function parseAttachWiredPreviewInput(body: unknown): ParseResult<AttachWiredPreviewInput> {
  if (!isRecord(body)) {
    return { ok: false, message: "Expected a JSON object" };
  }

  const wiredPreviewId = parseString(body.wiredPreviewId, "wiredPreviewId");
  if (!wiredPreviewId.ok) {
    return wiredPreviewId;
  }

  return { ok: true, value: { wiredPreviewId: wiredPreviewId.value } };
}
