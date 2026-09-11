# ADR 0010: Deterministic Hot Path and Socket Recovery

## Status

Accepted

## Context

Model-generated Event Transcripts blocked persistence and websocket publication for every Codex event. Measured completed Runs averaged about 7.8 seconds per event, and most transcript calls timed out. Separately, the PWA fetched a full Thread state snapshot every two seconds even while websocket heartbeats were healthy; large Threads produced snapshots around 738 KB.

## Decision

Event Transcription is a synchronous deterministic projection from normalized event fields. No model call may occur between receiving a Codex event and persisting or publishing it.

The optional Opencozy Model is reserved for explicit manual compaction. ADR 0017 removes automatic Context Compaction from Run dispatch to preserve model history.

Websocket events are the primary live update path. The PWA fetches a full Thread state snapshot on initial load and recovery only: a stale heartbeat, focus, online, or return to visibility. Concurrent recovery triggers share one in-flight request. Healthy heartbeat checks do not fetch Thread state.

Heartbeats carry the backend-owned Thread status and reconcile orphaned Run leases (ADR 0005). This closes the gap where a reconnect snapshot precedes lease expiry and healthy heartbeats would otherwise prevent further recovery. Failed snapshot requests remain eligible for timed retry, and disconnect retries are spaced to avoid a reconnect loop while the backend is unavailable. Successful recovery clears connection errors separately from operation errors.

Startup reads retry independently of Thread selection and keep their errors separate from operation failures. Failed Timeline and snapshot reads remain eligible for recovery even when websocket heartbeats are healthy. A successful write followed by a failed snapshot only schedules read recovery: it must not restore a sent prompt as a failed draft or resend the operation.

Codex Adapter payloads persist only normalized fields needed by mobile presentation and diagnostics. They do not duplicate the complete app-server item.

## Consequences

Timeline publication is bounded by local mapping, SQLite persistence, and websocket delivery rather than a remote model. Healthy clients stop transferring repeated full snapshots. Recovery still converges on backend-owned state after mobile suspension or a dead socket.

The deterministic transcript may be less expressive than a model rewrite, so presentation quality belongs in tested projection code. Snapshot recovery remains intentionally simple; cursor-based deltas and timeline virtualization can be added if initial loads of very long Threads remain expensive.
