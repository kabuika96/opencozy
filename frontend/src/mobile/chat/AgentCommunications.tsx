import { useMemo, useState } from "react";
import type { TimelineEventRecord } from "../api";
import type { AgentBranch } from "./agentBranches";
import { PretextText } from "../text/PretextText";
import "./AgentCommunications.css";

type AgentCommunicationsProps = {
  branches: AgentBranch[];
  events: TimelineEventRecord[];
  mainThreadId: string;
  onSelect(id: string | null): void;
  selectedBranchId: string | null;
};

type Communication = {
  body: string;
  id: string;
  recipients: string[];
  sender: string;
  status: string | null;
};

const initialLimit = 30;
const mainSenderId = "__liteharness_main__";

export function AgentCommunications({ branches, events, mainThreadId, onSelect, selectedBranchId }: AgentCommunicationsProps) {
  const [limit, setLimit] = useState(initialLimit);
  const messages = useMemo(() => communicationsFor(events, selectedBranchId), [events, selectedBranchId]);
  const labels = useMemo(() => new Map(branches.map(branch => [branch.id, branch.label])), [branches]);
  const hidden = Math.max(0, messages.length - limit);
  const shown = hidden ? messages.slice(hidden) : messages;

  if (messages.length === 0) return null;
  return <details className="lh-agent-communications">
    <summary>Agent messages · {messages.length}</summary>
    <div className="lh-agent-communications-list">
      {hidden > 0 ? <button className="lh-agent-messages-earlier" onClick={() => setLimit(current => current + initialLimit)}>Show earlier ({hidden})</button> : null}
      {shown.map(message => <article key={message.id}>
        <div className="lh-agent-message-route">
          <AgentLink id={message.sender} labels={labels} mainThreadId={mainThreadId} onSelect={onSelect} />
          <span aria-hidden>→</span>
          {message.recipients.map((recipient, index) => <span key={recipient}>
            {index > 0 ? <span aria-hidden>, </span> : null}
            <AgentLink id={recipient} labels={labels} mainThreadId={mainThreadId} onSelect={onSelect} />
          </span>)}
          {message.status ? <small>{deliveryLanguage(message.status)}</small> : null}
        </div>
        <PretextText className="lh-agent-message-body" text={message.body} />
      </article>)}
    </div>
  </details>;
}

export function communicationsFor(events: TimelineEventRecord[], selectedBranchId: string | null): Communication[] {
  const latest = new Map<string, Communication>();
  for (const event of events) {
    const payload = event.payload;
    const tool = readString(payload.collabTool)?.replace(/[_-]/g, "").toLowerCase();
    const body = readString(payload.prompt) ?? readString(payload.agentPrompt);
    const recipients = readStrings(payload.receiverThreadIds);
    if ((!tool || (tool !== "sendinput" && tool !== "sendmessage" && tool !== "spawnagent" && tool !== "spawn")) || !body || recipients.length === 0) continue;
    const sender = readString(payload.senderThreadId)
      ?? readString(payload.agentThreadId)
      ?? mainSenderId;
    if (selectedBranchId && sender !== selectedBranchId && !recipients.includes(selectedBranchId)) continue;
    const key = `${event.runId ?? event.threadId}:${readString(payload.stableKey) ?? event.id}`;
    latest.set(key, { body, id: event.id, recipients, sender, status: readString(payload.status) });
  }
  return Array.from(latest.values());
}

function AgentLink({ id, labels, mainThreadId, onSelect }: { id: string; labels: Map<string, string>; mainThreadId: string; onSelect(id: string | null): void }) {
  const main = id === mainThreadId || id === mainSenderId;
  return <button type="button" onClick={() => onSelect(main ? null : id)}>{main ? "Main" : labels.get(id) ?? `Agent ${id.slice(-4)}`}</button>;
}

function deliveryLanguage(status: string): string {
  if (["in_progress", "inProgress", "running", "pending"].includes(status)) return "sending";
  if (["completed", "done", "success"].includes(status)) return "delivered";
  if (["failed", "error", "errored"].includes(status)) return "not delivered";
  return status.replaceAll("_", " ");
}

function readString(value: unknown): string | null { return typeof value === "string" && value.trim() ? value : null; }
function readStrings(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => Boolean(readString(item))) : []; }
