import type { HarnessEvent } from "../harnesses/types.js";

export type EventTranscript = {
  action: string;
  actionHtml: string;
  resultHtml: string;
  resultSummary: string;
  source: "fallback" | "model";
};

export type EventTranscriptionContext = {
  runId: string;
  threadId: string;
  workspacePath: string;
};

export type EventTranscriber = {
  transcribe(event: HarnessEvent, context: EventTranscriptionContext): HarnessEvent;
};

export function createEventTranscriber(): EventTranscriber {
  return {
    transcribe(event) {
      return withTranscript(event, fallbackTranscript(event));
    },
  };
}

function withTranscript(event: HarnessEvent, transcript: EventTranscript): HarnessEvent {
  return {
    ...event,
    payload: {
      ...event.payload,
      transcript,
    },
  };
}

export function fallbackTranscript(event: HarnessEvent): EventTranscript {
  const payload = event.payload ?? {};
  const liteharnessType = readString(payload.liteharnessType) ?? defaultLiteHarnessType(event.type);
  const status = readString(payload.status);
  const text = oneLine(event.text, 140);

  if (liteharnessType === "execution") {
    const command = readString(payload.command) ?? readString(readRecord(payload.codexItem)?.command) ?? text;
    const exitCode = readNumber(payload.exitCode) ?? readNumber(readRecord(payload.codexItem)?.exit_code);
    const running = status === "in_progress";
    const failed = typeof exitCode === "number" && exitCode !== 0;
    const resultSummary = running ? "Running now" : failed ? `Exited ${exitCode}` : typeof exitCode === "number" ? "Completed successfully" : status ? titleCase(status) : "Command observed";
    return transcript({
      action: command,
      actionHtml: `<code>${escapeHtml(oneLine(command, 120))}</code>`,
      resultHtml: statusHtml(resultSummary, failed ? "error" : running ? "warn" : "ok"),
      resultSummary,
    });
  }

  if (liteharnessType === "file-change") {
    const changes = readArray(payload.changes) ?? readArray(readRecord(payload.codexItem)?.changes) ?? [];
    const firstPath = readString(readRecord(changes[0])?.path);
    const resultSummary = changes.length > 0 ? `${changes.length} ${changes.length === 1 ? "file" : "files"} changed${firstPath ? `, including ${firstPath}` : ""}` : text;
    return transcript({
      action: "Update files",
      actionHtml: iconHtml("file", "Update files"),
      resultHtml: `<span class="lh-event-info">${escapeHtml(oneLine(resultSummary, 140))}</span>`,
      resultSummary,
    });
  }

  if (liteharnessType === "tool-call") {
    const server = readString(payload.server) ?? readString(readRecord(payload.codexItem)?.server);
    const tool = readString(payload.tool) ?? readString(readRecord(payload.codexItem)?.tool);
    const toolName = server && tool ? `${server}/${tool}` : tool ?? server ?? "tool";
    const error = readString(payload.toolError) ?? readString(readRecord(readRecord(payload.codexItem)?.error)?.message);
    return transcript({
      action: `Use ${toolName}`,
      actionHtml: `Use <code>${escapeHtml(toolName)}</code>`,
      resultHtml: error ? statusHtml(error, "error") : statusHtml(status ? titleCase(status) : "Tool call observed", status === "failed" ? "error" : "info"),
      resultSummary: error ? oneLine(error, 140) : status ? titleCase(status) : "Tool call observed",
    });
  }

  if (liteharnessType === "todo-list") {
    const items = readArray(payload.items) ?? readArray(readRecord(payload.codexItem)?.items) ?? [];
    const completed = items.filter((item) => readRecord(item)?.completed === true).length;
    return transcript({
      action: "Update plan",
      actionHtml: iconHtml("plan", "Update plan"),
      resultHtml: `<span class="lh-event-info">${completed}/${items.length} done</span>`,
      resultSummary: items.length > 0 ? `${completed}/${items.length} done` : text,
    });
  }

  if (liteharnessType === "web-search") {
    const query = readString(payload.query) ?? readString(readRecord(payload.codexItem)?.query) ?? text;
    return transcript({
      action: "Search the web",
      actionHtml: iconHtml("search", "Search the web"),
      resultHtml: `<span class="lh-event-muted">${escapeHtml(oneLine(query, 140))}</span>`,
      resultSummary: oneLine(query, 140),
    });
  }

  if (liteharnessType === "subagent") {
    const nickname = readString(payload.agentNickname);
    const role = readString(payload.agentRole);
    const collabTool = readString(payload.collabTool);
    const agentStatus = readString(payload.agentStatus) ?? status ?? "running";
    const label = nickname ?? role ?? "Subagent";
    const action = collabTool === "spawnAgent"
      ? "Spawn subagent"
      : collabTool === "wait"
        ? "Wait for subagents"
        : collabTool === "sendInput"
          ? "Steer subagent"
          : collabTool === "closeAgent"
            ? "Close subagent"
            : `${label} activity`;
    return transcript({
      action,
      actionHtml: `<span>${escapeHtml(action)}</span>`,
      resultHtml: `<span class="lh-event-info">${escapeHtml(titleCase(agentStatus))}</span>`,
      resultSummary: titleCase(agentStatus),
    });
  }

  if (liteharnessType === "error" || event.type === "run.failed") {
    return transcript({
      action: "Handle failure",
      actionHtml: statusHtml("Handle failure", "error"),
      resultHtml: statusHtml(text || "Run failed", "error"),
      resultSummary: text || "Run failed",
    });
  }

  if (liteharnessType === "assistant-message") {
    return transcript({
      action: "Codex replied",
      actionHtml: iconHtml("message", "Codex replied"),
      resultHtml: `<span class="lh-event-muted">${escapeHtml(text)}</span>`,
      resultSummary: text,
    });
  }

  if (liteharnessType === "reasoning") {
    return transcript({
      action: "Think through the run",
      actionHtml: iconHtml("reasoning", "Think through the run"),
      resultHtml: `<span class="lh-event-muted">${escapeHtml(text)}</span>`,
      resultSummary: text,
    });
  }

  return transcript({
    action: defaultAction(event.type),
    actionHtml: iconHtml("status", defaultAction(event.type)),
    resultHtml: `<span class="lh-event-muted">${escapeHtml(text || defaultAction(event.type))}</span>`,
    resultSummary: text || defaultAction(event.type),
  });
}

function transcript(input: Omit<EventTranscript, "source">): EventTranscript {
  return {
    action: oneLine(input.action, 96),
    actionHtml: oneLine(input.actionHtml, 900),
    resultHtml: oneLine(input.resultHtml, 900),
    resultSummary: oneLine(input.resultSummary, 140),
    source: "fallback",
  };
}

function statusHtml(text: string, tone: "error" | "info" | "ok" | "warn"): string {
  return `<span class="lh-event-${tone}">${escapeHtml(oneLine(text, 140))}</span>`;
}

function iconHtml(kind: string, label: string): string {
  void kind;
  return `<span>${escapeHtml(label)}</span>`;
}

function defaultAction(type: string): string {
  if (type === "thread.started") return "Start thread";
  if (type === "run.started") return "Start run";
  if (type === "run.completed") return "Finish run";
  if (type === "approval.requested") return "Request approval";
  if (type === "approval.responded") return "Answer approval";
  return "Update status";
}

function defaultLiteHarnessType(type: HarnessEvent["type"]): string {
  if (type === "harness.output") return "assistant-message";
  if (type === "run.failed") return "error";
  if (type === "approval.requested") return "approval";
  if (type === "approval.responded") return "user-prompt";
  return "lifecycle";
}

function titleCase(value: string): string {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function oneLine(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
