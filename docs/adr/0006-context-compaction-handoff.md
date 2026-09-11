# ADR 0006: Context Compaction Handoff

## Status

Accepted; automatic dispatch compaction superseded by ADR 0017.

## Context

Opencozy Threads can accumulate long Timeline history. Re-sending the whole visible timeline to a Harness eventually wastes context on stale tool output, but deleting old history would break mobile reconnects and make future agents lose why the Thread is in its current state.

Hermes-style compaction points to a useful shape: protect the beginning and recent tail, summarize the older middle, and carry forward a structured handoff. Opencozy still has to preserve its Harness Adapter boundary. The PWA should not know Codex prompt formats, and Harness SDK/protocol details should stay inside backend adapters.

## Decision

Opencozy will implement Context Compaction as a backend-owned Timeline operation:

- Compaction reads normalized Timeline Events, not raw Harness SDK events.
- It protects a small head, the latest user-authored Timeline Event, and recent tail, summarizes the older middle into a structured Compaction Handoff, and inserts a visible `thread.compacted` Timeline Event with Harness Output Type `compaction`.
- Summarized Timeline Events remain stored for diagnostics but are hidden from the primary timeline, except that the latest user-authored Timeline Event remains visible when it falls inside the compacted middle.
- The latest Compaction Handoff is shadow-added to the next Harness request beside the latest user message. The stored `run.submitted` prompt remains exactly what the user typed.
- The handoff deterministically includes the immediately preceding user and assistant messages from the protected tail. A short latest message such as “yes” must remain associated with the question or proposal it answers when compaction starts a fresh Harness context.
- After compaction, Opencozy clears the Harness-owned thread id so the next Run starts from the handoff instead of resuming a Harness context that still carries the old full history.
- Context Compaction is explicitly requested. ADR 0017 removes automatic compaction before Run dispatch so follow-up messages preserve the existing model prefix.

## Consequences

Long Threads can continue with a smaller Harness request while preserving mobile scrollback shape and backend diagnostics.

Manual compaction uses the optional Opencozy Model; Event Transcription remains deterministic (ADR 0010). If model summarization fails, Opencozy writes a deterministic fallback summary and does not fail Harness execution. Fallback statements are labeled unverified, user steering is retained, and neither completion nor project constraints are invented from assistant progress text. The handoff interprets later status requests and confirmations within the ongoing objective.

Resetting the Harness-owned thread id is deliberate: without it, a resumed Harness context may still include the old hidden history and defeat compaction. This creates a fresh Harness continuation point while keeping Opencozy's Thread stable for the user.

The handoff prompt becomes part of backend dispatch, not frontend presentation. The PWA renders the `compaction` Timeline Event like any other normalized output and does not assemble Harness prompts.
