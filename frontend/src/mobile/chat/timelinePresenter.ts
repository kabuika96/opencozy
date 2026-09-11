import type { FileAsset, HarnessInputQuestion, TimelineEventRecord } from "../api";
import { asFileAsset } from '../assets/fileAsset';

export type HarnessOutputType =
  | "approval"
  | "assistant-message"
  | "compaction"
  | "error"
  | "execution"
  | "file-change"
  | "file-asset"
  | "input"
  | "lifecycle"
  | "liteharness-waiting"
  | "reasoning"
  | "reasoning-summary"
  | "subagent"
  | "todo-list"
  | "tool-call"
  | "user-prompt"
  | "web-search";

export type TimelineEventTone = "answer" | "completion" | "error" | "progress" | "query";

export type TimelineRenderEntry = {
  assets?: FileAsset[];
  action: string;
  actionHtml: string;
  aggregatedOutput: string | null;
  approvalId: string | null;
  changes: FileChange[];
  command: string | null;
  createdAt: string;
  children: TimelineRenderEntry[];
  event: TimelineEventRecord | null;
  exitCode: number | null;
  id: string;
  inputRequestId: string | null;
  interactionStatus: "pending" | "resolved" | null;
  items: TodoItem[];
  query: string | null;
  questions: HarnessInputQuestion[];
  runId: string | null;
  server: string | null;
  stableKey: string;
  status: string | null;
  resultHtml: string;
  resultSummary: string;
  summaryHtml: string | null;
  summaryText: string | null;
  text: string;
  title: string;
  transcriptSource: "fallback" | "model" | null;
  tool: string | null;
  toolError: string | null;
  type: HarnessOutputType;
};

const eventProjectionCache = new WeakMap<TimelineEventRecord, TimelineRenderEntry>();

type EventTranscript = {
  action: string;
  actionHtml: string;
  resultHtml: string;
  resultSummary: string;
  source: "fallback" | "model";
};

type FileChange = {
  kind: string;
  path: string;
};

type TodoItem = {
  completed: boolean;
  text: string;
};

const eventLabels: Record<string, string> = {
  "approval.requested": "Approval",
  "approval.responded": "You",
  "harness.output": "Output",
  "harness.status": "Status",
  "input.requested": "Input",
  "input.responded": "You",
  "run.completed": "Complete",
  "run.failed": "Failed",
  "run.started": "Started",
  "run.steered": "You",
  "run.submitted": "You",
  "thread.compacted": "Context",
  "thread.started": "Thread",
};

const outputLabels: Record<HarnessOutputType, string> = {
  approval: "Approval",
  "assistant-message": "Output",
  compaction: "Context",
  error: "Error",
  execution: "Ran",
  "file-change": "Files",
  "file-asset": "File",
  input: "Input",
  lifecycle: "Status",
  "liteharness-waiting": "Working",
  reasoning: "Reasoning",
  "reasoning-summary": "Reasoning",
  subagent: "Subagent",
  "todo-list": "Plan",
  "tool-call": "Tool",
  "user-prompt": "You",
  "web-search": "Search",
};

export function timelineEventLabel(event: Pick<TimelineEventRecord, "type">): string {
  return eventLabels[event.type] ?? event.type;
}

export function timelineEventText(event: Pick<TimelineEventRecord, "payload" | "type">): string {
  const text = event.payload.text;
  if (Array.isArray(event.payload.attachments) && event.payload.attachments.length && typeof text === "string") return text;
  return typeof text === "string" && text.trim() ? text : timelineEventLabel(event);
}

export function timelineEventTone(event: Pick<TimelineEventRecord, "payload" | "type">): TimelineEventTone {
  const type = outputTypeFromEvent(event);
  if (type === "user-prompt") {
    return "query";
  }
  if (type === "assistant-message") {
    return "answer";
  }
  if (type === "error" || type === "approval") {
    return "error";
  }
  if (event.type === "run.completed") {
    return "completion";
  }
  return "progress";
}

export function buildTimelineRenderEntries(
  events: TimelineEventRecord[],
): TimelineRenderEntry[] {
  const entries = resolveInteractionEntries(mergeUpdatedTimelineEntries(events.filter(isVisibleTimelineEvent)));
  return collapseReasoningEntries(stackFileEntries(entries));
}

function stackFileEntries(entries: TimelineRenderEntry[]): TimelineRenderEntry[] {
  const output: TimelineRenderEntry[] = [];
  const stacks = new Map<string, number>();
  for (const entry of entries) {
    const scope = `${entry.event?.threadId}:${entry.runId}:${readString(entry.event?.payload.agentThreadId) ?? 'main'}`;
    if (entry.type === 'user-prompt' || entry.type === 'compaction' || entry.event?.type === 'run.completed' || entry.event?.type === 'run.failed') stacks.delete(scope);
    const asset = entry.type === 'file-asset' ? asFileAsset(entry.event?.payload.asset) : null;
    if (!asset) { output.push(entry); continue; }
    const position = entry.runId ? stacks.get(scope) : undefined;
    if (position === undefined) {
      stacks.set(scope, output.length);
      output.push({ ...entry, assets: [asset] });
    } else {
      const first = output[position]!;
      if (!first.assets!.some(value => value.id === asset.id)) output[position] = { ...first, assets: [...first.assets!, asset] };
    }
  }
  return output;
}

function isVisibleTimelineEvent(event: TimelineEventRecord): boolean {
  return event.type !== "thread.started" && event.type !== "run.started";
}

function mergeUpdatedTimelineEntries(events: TimelineEventRecord[]): TimelineRenderEntry[] {
  const entries: TimelineRenderEntry[] = [];
  const positions = new Map<string, number>();

  for (const event of events) {
    const entry = timelineRenderEntry(event);
    const existingIndex = positions.get(entry.stableKey);
    if (existingIndex === undefined) {
      positions.set(entry.stableKey, entries.length);
      entries.push(entry);
    } else {
      const previous = entries[existingIndex];
      if (previous) {
        entries[existingIndex] = mergeTimelineEntries(previous, entry);
      }
    }
  }

  return entries;
}

function resolveInteractionEntries(entries: TimelineRenderEntry[]): TimelineRenderEntry[] {
  const resolved = new Set<string>();
  for (const entry of entries) {
    if (!entry.event) continue;
    if (entry.event.type === "approval.responded" && entry.approvalId) {
      resolved.add(`approval:${entry.approvalId}`);
    }
    if (entry.event.type === "input.responded" && entry.inputRequestId) {
      resolved.add(`input:${entry.inputRequestId}`);
    }
  }
  if (resolved.size === 0) return entries;
  return entries.map((entry) => {
    const key = entry.type === "approval" && entry.approvalId
      ? `approval:${entry.approvalId}`
      : entry.type === "input" && entry.inputRequestId
        ? `input:${entry.inputRequestId}`
        : null;
    return key && resolved.has(key) ? { ...entry, interactionStatus: "resolved" } : entry;
  });
}

function collapseReasoningEntries(entries: TimelineRenderEntry[]): TimelineRenderEntry[] {
  const collapsed: TimelineRenderEntry[] = [];
  let buffer: TimelineRenderEntry[] = [];
  let summaryIndex = 0;

  const flush = (isOpen = false) => {
    if (buffer.length === 0) return;
    collapsed.push(reasoningSummaryEntry(buffer, summaryIndex, isOpen));
    summaryIndex += 1;
    buffer = [];
  };

  for (const entry of entries) {
    if (entry.type === "user-prompt" || entry.type === "assistant-message" || entry.type === "file-asset") {
      flush();
      collapsed.push(entry);
      continue;
    }

    if (isCollapsibleReasoningEntry(entry)) {
      buffer.push(entry);
      continue;
    }

    flush();
    collapsed.push(entry);
  }

  flush(true);
  return collapsed;
}

function timelineRenderEntry(event: TimelineEventRecord): TimelineRenderEntry {
  const cached = eventProjectionCache.get(event);
  if (cached) {
    return cached;
  }
  const payload = event.payload;
  const type = outputTypeFromEvent(event);
  const codexItem = readRecord(payload.codexItem);
  const status = readString(payload.status)
    ?? readString(codexItem?.status)
    ?? (type === "subagent" ? normalizedSubagentStatus(payload, codexItem) : null)
    ?? statusFromEvent(event.type);
  const title = titleForEvent(event, type, status);
  const transcript = readTranscript(payload.transcript);
  const fallbackAction = fallbackActionForEntry(event, type, status);
  const fallbackActionHtml = fallbackActionHtmlForEntry(event, type);
  const fallbackResult = fallbackResultForEntry(event, type, status);
  const useTranscriptAction = Boolean(transcript && !(type === "execution" && transcript.source === "fallback"));

  const entry: TimelineRenderEntry = {
    action: useTranscriptAction ? transcript?.action ?? fallbackAction : fallbackAction,
    actionHtml: useTranscriptAction ? transcript?.actionHtml ?? fallbackActionHtml : fallbackActionHtml,
    aggregatedOutput: readString(payload.aggregatedOutput) ?? readString(codexItem?.aggregated_output),
    approvalId: readString(payload.approvalId),
    changes: readFileChanges(payload.changes) ?? readFileChanges(codexItem?.changes) ?? [],
    command: readString(payload.command) ?? readString(codexItem?.command),
    createdAt: event.createdAt,
    children: [],
    event,
    exitCode: readNumber(payload.exitCode) ?? readNumber(codexItem?.exit_code),
    id: event.id,
    inputRequestId: readString(payload.inputRequestId),
    interactionStatus: type === "approval" || type === "input" ? "pending" : null,
    items: readTodoItems(payload.items) ?? readTodoItems(codexItem?.items) ?? [],
    query: readString(payload.query) ?? readString(codexItem?.query),
    questions: readInputQuestions(payload.questions) ?? [],
    runId: event.runId,
    server: readString(payload.server) ?? readString(codexItem?.server),
    stableKey: stableKeyForEvent(event, type),
    status,
    resultHtml: transcript?.resultHtml ?? `<span class="lh-event-muted">${escapeHtml(fallbackResult)}</span>`,
    resultSummary: transcript?.resultSummary ?? fallbackResult,
    summaryHtml: null,
    summaryText: null,
    text: timelineEventText(event),
    title,
    transcriptSource: transcript?.source ?? null,
    tool: readString(payload.tool) ?? readString(codexItem?.tool),
    toolError: readString(payload.toolError) ?? readString(readRecord(codexItem?.error)?.message),
    type,
  };
  eventProjectionCache.set(event, entry);
  return entry;
}

function reasoningSummaryEntry(entries: TimelineRenderEntry[], index: number, isOpen: boolean): TimelineRenderEntry {
  const first = entries[0];
  const latestActive = latestActiveEntry(entries);
  const distribution = reasoningDistribution(entries);
  const summary = reasoningNarrative(entries);
  const failed = entries.some((entry) => entry.status === "failed" || entry.type === "error");
  const status = failed ? "failed" : latestActive || isOpen ? "in_progress" : "completed";
  const source = entries.some((entry) => entry.transcriptSource === "model")
    ? "model"
    : entries.some((entry) => entry.transcriptSource === "fallback")
      ? "fallback"
      : null;

  return {
    action: "Reasoning",
    actionHtml: "<span>Reasoning</span>",
    aggregatedOutput: null,
    approvalId: null,
    changes: [],
    command: null,
    createdAt: first?.createdAt ?? new Date(0).toISOString(),
    children: entries,
    event: null,
    exitCode: null,
    id: `reasoning-summary:${first?.runId ?? first?.id ?? "local"}:${index}`,
    inputRequestId: null,
    interactionStatus: null,
    items: [],
    query: null,
    questions: [],
    runId: first?.runId ?? null,
    server: null,
    stableKey: `reasoning-summary:${first?.runId ?? first?.id ?? "local"}:${index}`,
    status,
    resultHtml: distribution.html,
    resultSummary: distribution.text,
    summaryHtml: summary.html,
    summaryText: summary.text,
    text: summary.text,
    title: "Reasoning",
    transcriptSource: source,
    tool: null,
    toolError: null,
    type: "reasoning-summary",
  };
}

function reasoningNarrative(entries: TimelineRenderEntry[]): { html: string; text: string } {
  const active = latestActiveEntry(entries);
  const readTargets = uniqueReadTargets(entries);
  const writtenTargets = uniqueWrittenTargets(entries);
  const commands = entries.filter((entry) => entry.type === "execution" && !isReadLikeEntry(entry));
  const tools = entries.filter((entry) => entry.type === "tool-call");
  const searches = entries.filter((entry) => entry.type === "web-search");
  const subagentCount = countUniqueSubagents(entries);
  const planUpdated = entries.some((entry) => entry.type === "todo-list");
  const failed = entries.find((entry) => entry.status === "failed" || entry.type === "error");
  const lines: string[] = [];

  const exploration: string[] = [];
  if (readTargets.length > 0) exploration.push(`reviewed ${formatTargetList(readTargets, "file")}`);
  if (searches.length > 0) exploration.push(`searched ${formatCount(searches.length, "time")}`);
  if (tools.length > 0) exploration.push(`used ${formatCount(tools.length, "tool")}`);
  if (subagentCount > 0) exploration.push(`coordinated ${formatCount(subagentCount, "subagent")}`);
  if (exploration.length > 0) {
    lines.push(sentence(joinClauses(exploration)));
  }

  const outcome: string[] = [];
  if (writtenTargets.length > 0) outcome.push(`changed ${formatTargetList(writtenTargets, "file")}`);
  if (commands.length > 0) outcome.push(`ran ${formatCount(commands.length, "command")}`);
  if (planUpdated) outcome.push("updated the plan");
  if (failed) outcome.push(`hit ${trimSummary(failed.resultSummary).toLowerCase()}`);
  if (!failed && active) outcome.push(`now ${trimSummary(active.action).toLowerCase()}`);
  if (outcome.length > 0) {
    lines.push(sentence(joinClauses(outcome)));
  }

  if (lines.length === 0) {
    const significant = entries.find((entry) => entry.type !== "lifecycle") ?? entries[0];
    const fallback = significant
      ? `${trimSummary(significant.action)}: ${trimSummary(significant.resultSummary)}`
      : "Processed harness activity";
    lines.push(sentence(fallback));
  }

  const visibleLines = lines.slice(0, 2);
  return {
    html: visibleLines.map((line, index) => (
      `<span class="${index === 0 ? "lh-event-chip" : "lh-event-muted"}">${escapeHtml(line)}</span>`
    )).join("<br>"),
    text: visibleLines.join("\n"),
  };
}

function reasoningDistribution(entries: TimelineRenderEntry[]): { html: string; text: string } {
  const readCount = countReadOperations(entries);
  const wroteFileCount = countWrittenFiles(entries);
  const lineAdditions = countLineAdditions(entries);
  const exploredCount = entries.filter((entry) => (
    entry.type === "execution"
    || entry.type === "reasoning"
    || entry.type === "tool-call"
    || entry.type === "web-search"
  )).length;
  const toolCount = entries.filter((entry) => entry.type === "tool-call").length;
  const searchCount = entries.filter((entry) => entry.type === "web-search").length;
  const subagentCount = countUniqueSubagents(entries);
  const planUpdated = entries.some((entry) => entry.type === "todo-list");

  const parts: Array<{ className: string; text: string }> = [];
  if (readCount > 0) parts.push({ className: "lh-event-info", text: `read ${formatCount(readCount, "file")}` });
  if (wroteFileCount > 0) parts.push({ className: "lh-event-ok", text: `wrote ${formatCount(wroteFileCount, "file")}` });
  if (lineAdditions > 0) parts.push({ className: "lh-event-ok", text: `+${formatCompactNumber(lineAdditions)} lines` });
  if (exploredCount > 0) parts.push({ className: "lh-event-muted", text: `explored ${exploredCount}` });
  if (toolCount > 0) parts.push({ className: "lh-event-warn", text: `used ${formatCount(toolCount, "tool")}` });
  if (searchCount > 0) parts.push({ className: "lh-event-warn", text: `searched ${searchCount}` });
  if (subagentCount > 0) parts.push({ className: "lh-event-info", text: formatCount(subagentCount, "subagent") });
  if (planUpdated) parts.push({ className: "lh-event-chip", text: "updated plan" });
  if (parts.length === 0) parts.push({ className: "lh-event-muted", text: `processed ${formatCount(entries.length, "event")}` });

  return {
    html: parts.map((part) => `<span class="${part.className}">${escapeHtml(part.text)}</span>`).join("<span class=\"lh-event-muted\">, </span>"),
    text: parts.map((part) => part.text).join(", "),
  };
}

function uniqueReadTargets(entries: TimelineRenderEntry[]): string[] {
  const targets = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "execution" || !isReadLikeEntry(entry)) continue;
    for (const path of extractPathCandidates(`${entry.action} ${entry.command ?? ""}`)) {
      targets.add(path);
    }
  }
  return Array.from(targets);
}

function uniqueWrittenTargets(entries: TimelineRenderEntry[]): string[] {
  const targets = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "file-change") continue;
    for (const change of entry.changes) {
      targets.add(change.path);
    }
  }
  return Array.from(targets);
}

function latestActiveEntry(entries: TimelineRenderEntry[]): TimelineRenderEntry | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry?.status === "in_progress") {
      return entry;
    }
  }
  return null;
}

function isCollapsibleReasoningEntry(entry: TimelineRenderEntry): boolean {
  return entry.type === "execution"
    || entry.type === "file-change"
    || entry.type === "reasoning"
    || entry.type === "subagent"
    || entry.type === "todo-list"
    || entry.type === "tool-call"
    || entry.type === "web-search";
}

function countReadOperations(entries: TimelineRenderEntry[]): number {
  const readKeys = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "execution") continue;
    if (!isReadLikeEntry(entry)) continue;
    const paths = extractPathCandidates(`${entry.action} ${entry.command ?? ""}`);
    if (paths.length === 0) {
      readKeys.add(entry.stableKey);
      continue;
    }
    for (const path of paths) {
      readKeys.add(path);
    }
  }
  return readKeys.size;
}

function countWrittenFiles(entries: TimelineRenderEntry[]): number {
  const paths = new Set<string>();
  for (const entry of entries) {
    if (entry.type !== "file-change") continue;
    for (const change of entry.changes) {
      paths.add(change.path);
    }
  }
  return paths.size;
}

function countLineAdditions(entries: TimelineRenderEntry[]): number {
  let additions = 0;
  for (const entry of entries) {
    const text = `${entry.resultSummary} ${entry.text}`;
    const plusMatch = text.match(/\+([\d,]+)\s+lines?/i);
    const addedMatch = text.match(/([\d,]+)\s+lines?\s+(?:added|inserted)/i);
    const value = plusMatch?.[1] ?? addedMatch?.[1];
    if (value) additions += Number(value.replaceAll(",", ""));
  }
  return Number.isFinite(additions) ? additions : 0;
}

function isReadLikeEntry(entry: TimelineRenderEntry): boolean {
  const command = entry.command?.trim() ?? "";
  const action = entry.action.trim();
  if (/^(read|view|opened|inspect|list|search)\b/i.test(action)) return true;
  return /^(cat|sed|nl|rg|ls|find|wc)\b/.test(command);
}

function extractPathCandidates(text: string): string[] {
  return Array.from(text.matchAll(/(?:^|\s)([~./A-Za-z0-9_-][^\s'"`<>:]*\.(?:css|go|html|json|jsx|js|md|py|rs|sql|tsx|ts|txt|yaml|yml))/g))
    .map((match) => match[1])
    .filter((value): value is string => Boolean(value));
}

function formatCount(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

function formatTargetList(targets: string[], singular: string): string {
  if (targets.length === 0) return formatCount(0, singular);
  if (targets.length === 1) return shortPath(targets[0] ?? "");
  const [first, second] = targets;
  if (targets.length === 2 && first && second) {
    return `${shortPath(first)} and ${shortPath(second)}`;
  }
  return `${shortPath(first ?? "")} and ${formatCount(targets.length - 1, `other ${singular}`)}`;
}

function formatCompactNumber(count: number): string {
  if (count < 1000) return String(count);
  const rounded = Math.round(count / 100) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded}k`;
}

function joinClauses(clauses: string[]): string {
  if (clauses.length <= 1) return clauses[0] ?? "";
  const [first, ...rest] = clauses;
  return `${first}, then ${rest.join(", ")}`;
}

function sentence(text: string): string {
  const trimmed = trimSummary(text);
  if (!trimmed) return "";
  const capitalized = `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
  return /[.!?]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

function shortPath(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts.slice(-2).join("/") || path;
}

function trimSummary(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function outputTypeFromEvent(event: Pick<TimelineEventRecord, "payload" | "type">): HarnessOutputType {
  const explicitType = readString(event.payload.liteharnessType);
  if (isHarnessOutputType(explicitType)) {
    return explicitType;
  }

  const codexType = readString(readRecord(event.payload.codexItem)?.type);
  if (codexType === "agent_message") return "assistant-message";
  if (codexType === "command_execution") return "execution";
  if (codexType === "error") return "error";
  if (codexType === "file_change") return "file-change";
  if (codexType === "mcp_tool_call") return "tool-call";
  if (codexType === "reasoning") return "reasoning";
  if (codexType === "collab_tool_call" || codexType === "collabToolCall") return "subagent";
  if (codexType === "todo_list") return "todo-list";
  if (codexType === "web_search") return "web-search";

  if (event.type === "run.submitted") return "user-prompt";
  if (event.type === "run.steered") return "user-prompt";
  if (event.type === "approval.responded") return "user-prompt";
  if (event.type === "input.requested") return "input";
  if (event.type === "input.responded") return "user-prompt";
  if (event.type === "harness.output") return "assistant-message";
  if (event.type === "approval.requested") return "approval";
  if (event.type === "run.failed") return "error";
  return "lifecycle";
}

function stableKeyForEvent(event: TimelineEventRecord, type: HarnessOutputType): string {
  // A later show of the same asset after steering is a new presentation.
  // Deduplicate only within each response's stack, never across user messages.
  if (type === 'file-asset') return `event:${event.id}`;
  const scope = `${event.threadId}:${event.runId ?? "thread"}:${readString(event.payload.agentThreadId) ?? "main"}`;
  const stableKey = readString(event.payload.stableKey);
  if (stableKey) {
    return `${scope}:${stableKey}`;
  }

  const codexItemId = readString(readRecord(event.payload.codexItem)?.id);
  if (codexItemId) {
    return `${scope}:codex:item:${codexItemId}`;
  }

  if (type === "approval" && readString(event.payload.approvalId)) {
    return `${scope}:approval:${readString(event.payload.approvalId)}`;
  }

  if (type === "input" && readString(event.payload.inputRequestId)) {
    return `${scope}:input:${readString(event.payload.inputRequestId)}`;
  }

  if (type === "lifecycle" && event.runId) {
    return `${scope}:lifecycle`;
  }

  return `event:${event.id}`;
}

function mergeTimelineEntries(previous: TimelineRenderEntry, next: TimelineRenderEntry): TimelineRenderEntry {
  return {
    ...previous,
    ...next,
    createdAt: previous.createdAt,
    id: previous.id,
    stableKey: previous.stableKey,
  };
}

function titleForEvent(event: TimelineEventRecord, type: HarnessOutputType, status: string | null): string {
  if (type === "execution") {
    return status === "in_progress" ? "Running" : "Ran";
  }
  if (type === "lifecycle" && event.type === "run.completed") {
    return "Complete";
  }
  if (type === "lifecycle" && event.type === "run.started") {
    return "Started";
  }
  if (status) {
    return outputLabels[type];
  }
  return outputLabels[type] ?? timelineEventLabel(event);
}

function statusFromEvent(type: string): string | null {
  if (type === "run.started") return "in_progress";
  if (type === "run.completed") return "completed";
  if (type === "run.failed") return "failed";
  if (type === "thread.compacted") return "completed";
  return null;
}

function fallbackActionForEntry(event: TimelineEventRecord, type: HarnessOutputType, status: string | null): string {
  const payload = event.payload;
  const codexItem = readRecord(payload.codexItem);
  if (type === "execution") {
    const command = readString(payload.command) ?? readString(codexItem?.command) ?? timelineEventText(event);
    return command;
  }
  if (type === "file-change") return "Update files";
  if (type === "tool-call") {
    const server = readString(payload.server) ?? readString(codexItem?.server);
    const tool = readString(payload.tool) ?? readString(codexItem?.tool);
    return `Use ${server && tool ? `${server}/${tool}` : tool ?? server ?? "tool"}`;
  }
  if (type === "todo-list") return "Update plan";
  if (type === "web-search") return "Search the web";
  if (type === "subagent") return subagentAction(payload, codexItem);
  if (type === "assistant-message") return "Codex replied";
  if (type === "compaction") return "Compact context";
  if (type === "input") return "Need input";
  if (type === "reasoning") return "Think through the run";
  return titleForEvent(event, type, status);
}

function fallbackActionHtmlForEntry(event: TimelineEventRecord, type: HarnessOutputType): string {
  const payload = event.payload;
  const codexItem = readRecord(payload.codexItem);
  if (type === "execution") {
    const command = readString(payload.command) ?? readString(codexItem?.command) ?? timelineEventText(event);
    return `<code>${escapeHtml(command)}</code>`;
  }
  return escapeHtml(fallbackActionForEntry(event, type, readString(payload.status) ?? readString(codexItem?.status) ?? statusFromEvent(event.type)));
}

function fallbackResultForEntry(event: TimelineEventRecord, type: HarnessOutputType, status: string | null): string {
  const payload = event.payload;
  const codexItem = readRecord(payload.codexItem);
  if (type === "execution") {
    const exitCode = readNumber(payload.exitCode) ?? readNumber(codexItem?.exit_code);
    if (status === "in_progress") return "Running now";
    if (typeof exitCode === "number") return exitCode === 0 ? "Completed successfully" : `Exited ${exitCode}`;
  }
  if (type === "todo-list") {
    const items = readTodoItems(payload.items) ?? readTodoItems(codexItem?.items) ?? [];
    if (items.length > 0) return `${items.filter((item) => item.completed).length}/${items.length} done`;
  }
  if (type === "input") {
    const questions = readInputQuestions(payload.questions) ?? [];
    return questions[0]?.question ?? timelineEventText(event);
  }
  if (type === "subagent") {
    return subagentResult(payload, codexItem);
  }
  return timelineEventText(event);
}

function subagentAction(payload: Record<string, unknown>, codexItem: Record<string, unknown> | null): string {
  const nickname = readString(payload.agentNickname) ?? readString(codexItem?.agentNickname);
  const role = readString(payload.agentRole) ?? readString(codexItem?.agentRole);
  const collabTool = readString(payload.collabTool) ?? readString(codexItem?.collabTool);
  const count = subagentCount(payload, codexItem);
  const subject = nickname
    ? `${nickname}${role ? ` (${role})` : ""}`
    : count === 1
      ? "subagent"
      : formatCount(count, "subagent");
  return `${subagentVerb(collabTool)} ${subject}`;
}

function subagentResult(payload: Record<string, unknown>, codexItem: Record<string, unknown> | null): string {
  const count = subagentCount(payload, codexItem);
  const statuses = subagentStatuses(payload, codexItem);
  if (statuses.size === 0) {
    return formatCount(count, "subagent");
  }
  if (statuses.size === 1) {
    const status = statuses.keys().next().value as string;
    return `${formatCount(count, "subagent")} ${humanizeStatus(status)}`;
  }
  const statusSummary = Array.from(statuses.entries())
    .map(([status, statusCount]) => `${statusCount} ${humanizeStatus(status)}`)
    .join(", ");
  return `${formatCount(count, "subagent")}: ${statusSummary}`;
}

function subagentCount(payload: Record<string, unknown>, codexItem: Record<string, unknown> | null): number {
  return Math.max(1, subagentIdentityKeys(payload, codexItem).length);
}

function countUniqueSubagents(entries: TimelineRenderEntry[]): number {
  const agentIds = new Set<string>();
  let anonymousAgents = 0;
  for (const entry of entries) {
    if (entry.type !== "subagent") continue;
    const payload = entry.event?.payload ?? {};
    const codexItem = readRecord(payload.codexItem);
    const identities = subagentIdentityKeys(payload, codexItem);
    if (identities.length === 0) {
      anonymousAgents += 1;
      continue;
    }
    identities.forEach((identity) => agentIds.add(identity));
  }
  return agentIds.size + anonymousAgents;
}

function subagentIdentityKeys(
  payload: Record<string, unknown>,
  codexItem: Record<string, unknown> | null,
): string[] {
  const agentIds = new Set([
    ...readStringList(payload.receiverThreadIds),
    ...readStringList(codexItem?.receiverThreadIds),
  ]);
  const agentsStates = payload.agentsStates ?? codexItem?.agentsStates;
  if (Array.isArray(agentsStates)) {
    for (const state of agentsStates) {
      const record = readRecord(state);
      const id = readString(record?.threadId) ?? readString(record?.id) ?? readString(record?.agentNickname);
      if (id) agentIds.add(id);
    }
  } else {
    const record = readRecord(agentsStates);
    for (const id of Object.keys(record ?? {})) {
      agentIds.add(id);
    }
  }
  if (agentIds.size === 0) {
    const nickname = readString(payload.agentNickname) ?? readString(codexItem?.agentNickname);
    if (nickname) {
      agentIds.add(`nickname:${nickname}`);
    }
  }
  return Array.from(agentIds);
}

function subagentStatuses(
  payload: Record<string, unknown>,
  codexItem: Record<string, unknown> | null,
): Map<string, number> {
  const statuses = new Map<string, number>();
  const agentsStates = payload.agentsStates ?? codexItem?.agentsStates;
  const addStatus = (value: unknown) => {
    const state = readRecord(value);
    const status = readString(state?.status) ?? readString(state?.agentStatus) ?? readString(value);
    if (status) {
      statuses.set(status, (statuses.get(status) ?? 0) + 1);
    }
  };
  if (Array.isArray(agentsStates)) {
    agentsStates.forEach(addStatus);
  } else {
    Object.values(readRecord(agentsStates) ?? {}).forEach(addStatus);
  }
  if (statuses.size === 0) {
    addStatus(payload.agentStatus ?? codexItem?.agentStatus);
  }
  return statuses;
}

function normalizedSubagentStatus(
  payload: Record<string, unknown>,
  codexItem: Record<string, unknown> | null,
): string | null {
  const status = readString(payload.agentStatus) ?? readString(codexItem?.agentStatus);
  return status === "running" ? "in_progress" : status;
}

function subagentVerb(collabTool: string | null): string {
  const normalized = collabTool?.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase();
  if (normalized === "spawn" || normalized === "spawn_agent") return "Start";
  if (normalized === "send_input" || normalized === "send_message") return "Message";
  if (normalized === "wait" || normalized === "wait_agent") return "Wait for";
  if (normalized === "close" || normalized === "close_agent") return "Close";
  if (normalized === "resume" || normalized === "resume_agent") return "Resume";
  return "Coordinate";
}

function humanizeStatus(status: string): string {
  return status.replaceAll("_", " ").toLowerCase();
}

function readTranscript(value: unknown): EventTranscript | null {
  const record = readRecord(value);
  const action = readString(record?.action);
  const actionHtml = readString(record?.actionHtml);
  const resultHtml = readString(record?.resultHtml);
  const resultSummary = readString(record?.resultSummary);
  const source = record?.source;
  if (!action || !actionHtml || !resultHtml || !resultSummary) return null;
  if (source !== "fallback" && source !== "model") return null;
  return { action, actionHtml, resultHtml, resultSummary, source };
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
    : [];
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readFileChanges(value: unknown): FileChange[] | null {
  if (!Array.isArray(value)) return null;
  const changes = value.flatMap((item) => {
    const record = readRecord(item);
    const path = readString(record?.path);
    const kind = readString(record?.kind);
    return path && kind ? [{ kind, path }] : [];
  });
  return changes.length > 0 ? changes : null;
}

function readTodoItems(value: unknown): TodoItem[] | null {
  if (!Array.isArray(value)) return null;
  const items = value.flatMap((item) => {
    const record = readRecord(item);
    const text = readString(record?.text);
    const completed = record?.completed;
    return text && typeof completed === "boolean" ? [{ completed, text }] : [];
  });
  return items.length > 0 ? items : null;
}

function readInputQuestions(value: unknown): HarnessInputQuestion[] | null {
  if (!Array.isArray(value)) return null;
  const questions = value.flatMap((item) => {
    const record = readRecord(item);
    const allowOther = record?.allowOther;
    const header = readString(record?.header);
    const id = readString(record?.id);
    const isSecret = record?.isSecret;
    const options = readInputOptions(record?.options);
    const question = readString(record?.question);
    if (typeof allowOther !== "boolean" || !header || !id || typeof isSecret !== "boolean" || !question) {
      return [];
    }
    return [{
      allowOther,
      header,
      id,
      isSecret,
      options,
      question,
    }];
  });
  return questions.length > 0 ? questions : null;
}

function readInputOptions(value: unknown): HarnessInputQuestion["options"] {
  if (value === null) return null;
  if (!Array.isArray(value)) return null;
  const options = value.flatMap((item) => {
    const record = readRecord(item);
    const description = readString(record?.description);
    const label = readString(record?.label);
    return description && label ? [{ description, label }] : [];
  });
  return options.length > 0 ? options : null;
}

function isHarnessOutputType(value: string | null): value is HarnessOutputType {
  return Boolean(value && value in outputLabels);
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
