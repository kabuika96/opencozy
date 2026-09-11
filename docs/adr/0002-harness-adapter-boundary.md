# ADR 0002: Harness Adapter Boundary

## Status

Superseded by ADR 0009

## Context

Opencozy should support multiple Harnesses over time, but the first vertical slice is Codex. The project must avoid baking Codex-specific SDK details into the mobile UI while also avoiding a premature plugin system.

## Decision

Opencozy will define a backend `HarnessAdapter` boundary now and keep the v1 registry static.

The v1 registry contains only the Codex Adapter. The data model stores `harnessType` so additional Harnesses can be added later without changing the core Thread and Run concepts.

The Codex Adapter prefers `@openai/codex-sdk`. If the SDK is too coarse for required capabilities such as streaming events, approvals, or resume metadata, the adapter may use the Codex app-server protocol internally. Those protocol details must stay inside the adapter.

Active Run steering uses the same boundary. The PWA sends generic Run user input to the backend; the Codex Adapter owns translating that into Codex app-server `turn/steer` when available. A Steering Message is not a new Run and does not expose Codex turn ids, app-server request ids, or protocol payloads to the PWA.

## Consequences

The PWA can remain generic around Threads, Runs, Timeline Events, and Approval Requests while Codex-specific details stay in the Codex Adapter and Codex-oriented screens.

Opencozy will not implement dynamic plugins, marketplace loading, user-installed adapters, or arbitrary adapter scripts in v1.
