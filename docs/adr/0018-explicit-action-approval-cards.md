# ADR 0018: Explicit Action Approval Cards

## Status

Accepted

## Context

The owner wants Yes/No buttons when an agent needs consent, including for a backend restart. Native command approvals already render in the PWA, but an isolated check with the pinned Codex runtime showed that full-access mode can execute a harmless command with `require_escalated` without requesting approval. Command sandbox escalation therefore cannot enforce this interaction.

## Decision

Register a native `liteharness.request_approval({ action })` tool on newly created Harness Threads. The active main agent describes one concrete action and its material impact. The Codex Adapter keeps the tool request pending and emits the existing normalized `approval.requested` event. The existing device-owned approval endpoint records the user's decision and sends it back through the adapter. All approval cards use Yes/No labels.

The tool returns `{ approved, action }` and never executes the action. Only a successful positive response authorizes the exact action once. Rejection, cancellation, missing replies, and transport errors do not authorize it. Failed response delivery remains retryable; simultaneous decisions cannot both be delivered. Pending requests are discarded when their owning Run ends.

Keep Codex protocol and pending tool IDs inside the adapter. No new command endpoint or frontend protocol integration is introduced. Preparation and validation precede the approval card. Existing approval for a pending action remains valid and must not be requested again.

## Consequences

The explicit approval is independent of shell sandbox policy. It can pause for consent even when command execution itself needs no escalation. Backend restarts still require permission because active Runs do not survive them (ADR 0005).

The installed protocol accepts dynamic tools on Thread creation, not resume. New Threads receive the tool after backend activation; existing Threads retain their original tool definitions and history. Where absent, ask plainly. Never reset a Thread to add approval UI.

The attempted `request_user_input_async` fallback did not produce `input.requested` or `approval.requested` events in the running app. Its accepted result did not mean a mobile card existed. The owner saw only text; this fallback must not be advertised as working. Verification of the new native tool remains distinct from activation in the running backend.

Verification covers positive and negative decisions, waiting before a response, malformed input, retry and duplicate response handling, mobile buttons, and a pinned-runtime loopback probe without a live model or service restart.
