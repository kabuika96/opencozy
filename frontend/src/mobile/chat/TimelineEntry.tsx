import { FileAssetCard } from "../assets/FileAssetCard";
import { MessageAttachments } from "../attachments/MessageAttachments";
import { memo, useState, type ReactNode } from "react";
import { Brain } from "lucide-react";
import type { ThreadRecord } from "../api";
import type { TimelineRenderEntry } from "./timelinePresenter";
import { EventHtml } from "../text/EventHtml";
import { HarnessHtml } from "../text/HarnessHtml";
import { PretextCodeBlock, PretextText, toPretextInlineCode } from "../text/PretextText";

function TimelineEntryView({ activeThread, busy, entry, onApprovalDecision, onInputResponse }: {
  activeThread: ThreadRecord | null;
  busy: boolean;
  entry: TimelineRenderEntry;
  onApprovalDecision(threadId: string, approvalId: string, approved: boolean): Promise<void>;
  onInputResponse(threadId: string, inputRequestId: string, answers: Record<string, string[]>): Promise<void>;
}) {
  if (entry.type === "file-asset") return <FileAssetCard value={entry.event?.payload.asset} assets={entry.assets} />;

  if (entry.type === "user-prompt") {
    return (
      <article className="lh-mobile-turn is-sent">
        {entry.text ? <PretextText className="lh-mobile-query" text={entry.text} /> : null}
        {entry.event ? <MessageAttachments threadId={entry.event.threadId} value={entry.event.payload.attachments} /> : null}
      </article>
    );
  }

  if (entry.type === "assistant-message") {
    return (
      <article className="lh-mobile-turn is-received">
        <HarnessHtml className="lh-mobile-answer" html={entry.text} />
      </article>
    );
  }

  if (entry.type === "reasoning-summary") {
    return <ReasoningSummaryEntry entry={entry} />;
  }

  if (entry.type === "execution") {
    return <ExecutionEntry entry={entry} />;
  }

  if (entry.type === "file-change") {
    return <FileChangeEntry entry={entry} />;
  }

  if (entry.type === "tool-call") {
    return <ToolCallEntry entry={entry} />;
  }

  if (entry.type === "todo-list") {
    return <TodoListEntry entry={entry} />;
  }

  if (entry.type === "web-search") {
    return <TypedOutputEntry entry={entry} detail={entry.query ?? entry.text} />;
  }

  if (entry.type === "input") {
    return (
      <InputRequestEntry
        disabled={busy || activeThread?.status !== "needs_input" || entry.interactionStatus !== "pending"}
        entry={entry}
        onSubmit={(answers) => {
          if (!activeThread || !entry.inputRequestId) {
            return Promise.resolve();
          }
          return onInputResponse(activeThread.id, entry.inputRequestId, answers);
        }}
      />
    );
  }

  if (entry.type === "approval") {
    return (
      <ApprovalRequestEntry
        disabled={busy || activeThread?.status !== "needs_approval" || entry.interactionStatus !== "pending"}
        entry={entry}
        onDecision={(approved) => {
          if (!activeThread || !entry.approvalId) {
            return Promise.resolve();
          }
          return onApprovalDecision(activeThread.id, entry.approvalId, approved);
        }}
      />
    );
  }

  if (entry.type === "error") {
    return (
      <article className="lh-mobile-turn">
        <PretextText
          className="lh-mobile-error"
          text={entry.text}
        />
      </article>
    );
  }

  return <TypedOutputEntry entry={entry} detail={entry.text} />;
}

function ApprovalRequestEntry({ disabled, entry, onDecision }: {
  disabled: boolean;
  entry: TimelineRenderEntry;
  onDecision(approved: boolean): Promise<void>;
}) {
  return (
    <article className="lh-mobile-input-request">
      <div className="lh-mobile-input-request-header">
        <span>{entry.title}</span>
        <PretextText className="lh-mobile-input-request-text" text={entry.text} />
      </div>
      <div className="lh-mobile-approval-actions">
        <button
          className="lh-mobile-approval-button is-allow"
          disabled={disabled || !entry.approvalId}
          type="button"
          onClick={() => void onDecision(true)}
        >
          Yes
        </button>
        <button
          className="lh-mobile-approval-button"
          disabled={disabled || !entry.approvalId}
          type="button"
          onClick={() => void onDecision(false)}
        >
          No
        </button>
      </div>
    </article>
  );
}

function InputRequestEntry({ disabled, entry, onSubmit }: {
  disabled: boolean;
  entry: TimelineRenderEntry;
  onSubmit(answers: Record<string, string[]>): Promise<void>;
}) {
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const questions = entry.questions;
  const canSubmit = Boolean(entry.inputRequestId)
    && questions.length > 0
    && questions.every((question) => (answers[question.id] ?? []).some((value) => value.trim()));

  function setAnswer(questionId: string, value: string) {
    const trimmed = value.trim();
    setAnswers((current) => {
      const next = { ...current };
      if (trimmed) {
        next[questionId] = [trimmed];
      } else {
        delete next[questionId];
      }
      return next;
    });
  }

  return (
    <article className="lh-mobile-input-request">
      <div className="lh-mobile-input-request-header">
        <span>{entry.title}</span>
        <PretextText className="lh-mobile-input-request-text" text={entry.text} />
      </div>
      <form
        className="lh-mobile-input-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit || disabled) return;
          void onSubmit(answers);
        }}
      >
        {questions.map((question) => (
          <fieldset className="lh-mobile-input-question" key={question.id}>
            <legend>
              <span>{question.header}</span>
              <strong>{question.question}</strong>
            </legend>
            {question.options ? (
              <div className="lh-mobile-input-options">
                {question.options.map((option) => (
                  <label className="lh-mobile-input-option" key={option.label}>
                    <input
                      aria-label={option.label}
                      checked={(answers[question.id] ?? [])[0] === option.label}
                      disabled={disabled}
                      name={`${entry.id}:${question.id}`}
                      type="radio"
                      value={option.label}
                      onChange={() => setAnswer(question.id, option.label)}
                    />
                    <span>{option.label}</span>
                    <small>{option.description}</small>
                  </label>
                ))}
                {question.allowOther ? (
                  <label className="lh-mobile-input-other">
                    <span>Other</span>
                    <input
                      aria-label={`${question.header} other`}
                      disabled={disabled}
                      type={question.isSecret ? "password" : "text"}
                      value={isKnownInputOption(question.options, answers[question.id]?.[0]) ? "" : answers[question.id]?.[0] ?? ""}
                      onChange={(event) => setAnswer(question.id, event.currentTarget.value)}
                    />
                  </label>
                ) : null}
              </div>
            ) : (
              <textarea
                aria-label={question.header}
                autoCapitalize="sentences"
                disabled={disabled}
                rows={question.isSecret ? 1 : 2}
                value={answers[question.id]?.[0] ?? ""}
                onChange={(event) => setAnswer(question.id, event.currentTarget.value)}
              />
            )}
          </fieldset>
        ))}
        <button
          className="lh-mobile-input-send-button"
          disabled={disabled || !canSubmit}
          type="submit"
        >
          Send input
        </button>
      </form>
    </article>
  );
}

function isKnownInputOption(options: Array<{ label: string }>, value: string | undefined): boolean {
  return Boolean(value && options.some((option) => option.label === value));
}

function ReasoningSummaryEntry({ entry }: { entry: TimelineRenderEntry }) {
  const current = currentReasoningEntry(entry);
  const className = `lh-mobile-output lh-mobile-output-reasoning-summary ${statusClass(entry.status)}`;
  return (
    <article className={className}>
      <Brain aria-hidden="true" className="lh-mobile-reasoning-marker" size={11} strokeWidth={2.2} />
      <OutputDisclosure summary={<ReasoningSummary entry={entry} current={current} />}>
        {entry.children.length > 0 ? <ReasoningDetailList entries={entry.children} /> : null}
      </OutputDisclosure>
    </article>
  );
}

function ReasoningSummary({ current, entry }: { current: TimelineRenderEntry | null; entry: TimelineRenderEntry }) {
  return (
    <div className="lh-mobile-reasoning-summary">
      <div className="lh-mobile-reasoning-subrow lh-mobile-reasoning-distribution">
        <EventHtml className="lh-mobile-reasoning-distribution-text" html={entry.resultHtml} textFallback={entry.resultSummary} />
      </div>
      {entry.summaryHtml && entry.summaryText ? (
        <div className="lh-mobile-reasoning-subrow">
          <EventHtml className="lh-mobile-reasoning-narrative" html={entry.summaryHtml} textFallback={entry.summaryText} />
        </div>
      ) : null}
      {current ? (
        <div className="lh-mobile-reasoning-subrow lh-mobile-reasoning-current">
          <EventHtml className="lh-mobile-event-action" html={current.actionHtml} textFallback={current.action} />
          <EventHtml className="lh-mobile-event-result" html={current.resultHtml} textFallback={current.resultSummary} />
        </div>
      ) : null}
    </div>
  );
}

function ReasoningDetailList({ entries }: { entries: TimelineRenderEntry[] }) {
  return (
    <ul className="lh-mobile-reasoning-details">
      {entries.map((entry) => (
        <li className={statusClass(entry.status)} key={entry.stableKey}>
          {entry.type === "execution" ? <ExecutionEntry entry={entry} />
            : entry.type === "file-change" ? <FileChangeEntry entry={entry} />
            : entry.type === "tool-call" ? <ToolCallEntry entry={entry} />
            : entry.type === "todo-list" ? <TodoListEntry entry={entry} />
            : <TypedOutputEntry entry={entry} detail={entry.text} />}
        </li>
      ))}
    </ul>
  );
}

function currentReasoningEntry(entry: TimelineRenderEntry): TimelineRenderEntry | null {
  for (let index = entry.children.length - 1; index >= 0; index -= 1) {
    const child = entry.children[index];
    if (child && isPendingReasoningStatus(child.status)) {
      return child;
    }
  }
  if (!isPendingReasoningStatus(entry.status)) {
    return null;
  }
  for (let index = entry.children.length - 1; index >= 0; index -= 1) {
    const child = entry.children[index];
    if (child) {
      return child;
    }
  }
  return null;
}

function isPendingReasoningStatus(status: string | null): boolean {
  return status === "in_progress" || status === "pending";
}

function ExecutionEntry({ entry }: { entry: TimelineRenderEntry }) {
  const command = entry.command ?? entry.text;
  return (
    <article className={`lh-mobile-output lh-mobile-output-execution ${statusClass(entry.status)}`}>
      <OutputDisclosure
        summary={(
          <OutputSummary entry={entry} />
        )}
      >
        <code className="lh-mobile-command-preview" aria-label="Command">
          <ShellCommand command={command} />
        </code>
        {entry.aggregatedOutput ? (
          <PretextCodeBlock className="lh-mobile-command-output" text={entry.aggregatedOutput} />
        ) : null}
        {entry.exitCode !== null ? <p className="lh-mobile-output-footnote">exit {entry.exitCode}</p> : null}
      </OutputDisclosure>
    </article>
  );
}

function FileChangeEntry({ entry }: { entry: TimelineRenderEntry }) {
  const summary = entry.changes.length > 0
    ? `${entry.changes.length} ${entry.changes.length === 1 ? "file" : "files"}: ${entry.changes[0]?.path ?? ""}`
    : entry.text;
  return (
    <article className={`lh-mobile-output lh-mobile-output-file-change ${statusClass(entry.status)}`}>
      <OutputDisclosure summary={<OutputSummary entry={entry} />}>
        {entry.changes.length > 0 ? (
          <ul className="lh-mobile-file-list">
            {entry.changes.map((change) => (
              <li key={`${change.kind}:${change.path}`}>
                <PretextText className="lh-mobile-file-kind" text={change.kind} />
                <PretextText className="lh-mobile-file-path" text={toPretextInlineCode(change.path)} />
              </li>
            ))}
          </ul>
        ) : <PretextText className="lh-mobile-output-detail" text={summary} />}
      </OutputDisclosure>
    </article>
  );
}

function ToolCallEntry({ entry }: { entry: TimelineRenderEntry }) {
  const detail = entry.server && entry.tool ? `${entry.server}/${entry.tool}` : entry.text;
  return (
    <article className={`lh-mobile-output lh-mobile-output-tool-call ${statusClass(entry.status)}`}>
      <OutputDisclosure summary={<OutputSummary entry={entry} />}>
        <PretextText className="lh-mobile-output-detail" text={detail} />
        {entry.toolError ? <PretextText className="lh-mobile-error" text={entry.toolError} /> : null}
      </OutputDisclosure>
    </article>
  );
}

function TodoListEntry({ entry }: { entry: TimelineRenderEntry }) {
  const completedCount = entry.items.filter((item) => item.completed).length;
  const summary = entry.items.length > 0 ? `${completedCount}/${entry.items.length} done` : entry.text;
  return (
    <article className="lh-mobile-output lh-mobile-output-todo-list">
      <OutputDisclosure summary={<OutputSummary entry={entry} />}>
        {entry.items.length > 0 ? (
          <ul className="lh-mobile-todo-list">
            {entry.items.map((item) => (
              <li className={item.completed ? "done" : "pending"} key={item.text}>
                <span aria-hidden="true">{item.completed ? "[x]" : "[ ]"}</span>
                <PretextText className="lh-mobile-todo-text" text={item.text} />
              </li>
            ))}
          </ul>
        ) : <PretextText className="lh-mobile-output-detail" text={summary} />}
      </OutputDisclosure>
    </article>
  );
}

function TypedOutputEntry({ detail, entry }: { detail: string; entry: TimelineRenderEntry }) {
  const complete = entry.status === "completed" || entry.type === "lifecycle" && entry.event?.type === "run.completed";
  const className = `lh-mobile-output lh-mobile-output-${entry.type} ${statusClass(entry.status)}${complete ? " done" : ""}`;
  return (
    <article className={className}>
      <OutputDisclosure summary={<OutputSummary entry={entry} />}>
        <PretextText className="lh-mobile-output-detail" text={detail} />
      </OutputDisclosure>
    </article>
  );
}

function OutputSummary({ entry }: { entry: TimelineRenderEntry }) {
  return (
    <div className="lh-mobile-event-summary">
      <EventHtml className="lh-mobile-event-action" html={entry.actionHtml} textFallback={entry.action} />
      <EventHtml className="lh-mobile-event-result" html={entry.resultHtml} textFallback={entry.resultSummary} />
    </div>
  );
}

function OutputDisclosure({ children, summary }: { children?: ReactNode; summary: ReactNode }) {
  const hasChildren = Boolean(children);
  if (!hasChildren) {
    return <div className="lh-mobile-output-summary">{summary}</div>;
  }

  return (
    <details className="lh-mobile-output-disclosure">
      <summary className="lh-mobile-output-summary">
        {summary}
      </summary>
      <div className="lh-mobile-output-expanded">
        {children}
      </div>
    </details>
  );
}

function ShellCommand({ command }: { command: string }) {
  const tokens = tokenizeShellCommand(command);
  return (
    <>
      {tokens.map((token, index) => (
        <span className={shellTokenClass(token, index)} key={`${index}:${token}`}>
          {index > 0 ? " " : ""}
          {token}
        </span>
      ))}
    </>
  );
}


function statusClass(status: string | null): string {
  return status ? `is-${status.replaceAll("_", "-")}` : "";
}


function tokenizeShellCommand(command: string): string[] {
  return command.match(/"[^"]*"|'[^']*'|`[^`]*`|\S+/g) ?? [command];
}

function shellTokenClass(token: string, index: number): string {
  if (index === 0) return "lh-shell-token-bin";
  if (/^--?/.test(token)) return "lh-shell-token-flag";
  if (/^["'`]/.test(token)) return "lh-shell-token-string";
  if (token.includes("/") || token.startsWith("~")) return "lh-shell-token-path";
  if (/^\d+$/.test(token)) return "lh-shell-token-number";
  return "lh-shell-token-arg";
}


export const TimelineEntry = memo(TimelineEntryView);
