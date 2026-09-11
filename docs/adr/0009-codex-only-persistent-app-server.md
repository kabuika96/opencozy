# ADR 0009: Codex-Only Persistent App Server

## Status

Accepted

## Context

Opencozy originally anticipated several Harness implementations and preferred `@openai/codex-sdk`. The SDK starts a Codex process per Run and exposes a coarser surface than current Codex app-server. Opencozy now supports only Codex and needs low startup latency plus native steering, approvals, input requests, and subagent events.

## Decision

Opencozy supports only Codex. A static Codex Adapter remains as the backend integration boundary so app-server request ids, thread ids, item shapes, and lifecycle details do not leak into the PWA or store.

The backend depends directly on the pinned `@openai/codex` package. On startup it warms a Codex app-server stdio connection, initializes that connection once, and leases it across sequential Runs. Concurrent Runs may create additional connections; healthy idle connections return to the pool, while aborted or failed connections are discarded.

The adapter maps Codex child-thread, collaboration-tool, and subagent-activity messages into normalized `subagent` Timeline Events. It also owns steering and interactive app-server responses.

`mock` remains available only for tests and local UI smoke checks. There is no SDK production mode, dynamic adapter loading, or multi-Harness plugin surface.

## Consequences

Sequential Runs avoid repeated CLI startup and gain the full current Codex integration surface. The backend must update its protocol mapping when the pinned Codex package changes. Focused adapter tests and a real initialization smoke test guard that boundary.
