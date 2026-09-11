# ADR 0011: Per-Thread Execution Profiles and Agent Timelines

## Status

Accepted

## Context

The persistent Codex app-server removed process startup from the Run hot path, but first visible assistant output still waited for the completed message item. Fast mode was a browser-memory toggle, so it reset on reload and could not reliably shape resumed Threads.

Codex already emits child-thread and collaboration activity. Opencozy normalized the lifecycle rows but discarded the child thread's prompts, reasoning, tool work, and assistant output, leaving the owner unable to inspect delegated work from mobile.

## Decision

Opencozy owns a small static set of Execution Profiles and stores the selected profile plus Fast mode on each Thread.

- `default` (Balance, initially selected): GPT-6 Astra, high Main reasoning, high subagent reasoning, Fast by default.
- `speed` (Speed): GPT-6 Astra, medium Main reasoning, low subagent reasoning, Fast by default.
- `power` (Power): GPT-6 Astra, max Main reasoning, xhigh subagent reasoning, Standard by default.

These are the only visible choices. The retired `astra` ID is accepted as a compatibility alias for Balance and normalized when reading existing Threads; this does not rewrite persisted history. The existing `default` ID remains stable.

The backend resolves each profile inside the Codex Adapter and maps it to app-server thread, resume, turn, Fast-feature, and default-subagent configuration. Main and subagent model/effort settings are authoritative; environment model and effort settings apply only to utility calls. The adapter supplies normalized main and subagent summaries to `/api/config` from the same profile definitions used for Runs. Protocol configuration stays behind the adapter.

Profile instructions apply the subagent settings to every role, including planning, implementation, review, and nested work, with explicit tool overrides where permitted. Session collaboration policy and tool/model restrictions take precedence; these preferences do not authorize delegation. Fast remains a separately persisted per-Thread preference.

The Codex Adapter emits the first assistant-message delta immediately and throttles later cumulative snapshots. The completed message replaces the stream through the same Stable Output Key.

Child-thread item notifications are normalized into the owning Opencozy Timeline with `agentThreadId`, `parentThreadId`, nickname, and role fields. The PWA derives an Agent Timeline tree from those normalized fields, filters the visible timeline by branch, and provides Main/child/nested navigation. Child Threads do not become independent Opencozy Threads.

## Consequences

Fast and profile choices survive reload, reconnect, and Harness resume. The three profiles vary reasoning depth consistently across the Main line and subagents while keeping the same Astra model.

Streaming creates multiple durable snapshots for a long assistant message, but throttling bounds write and websocket volume and Stable Output Keys keep one rendered response.

Subagent work remains recoverable from the same backend Thread snapshot and device-local ownership boundary. The frontend does not issue raw child-thread requests or learn Codex protocol shapes.
