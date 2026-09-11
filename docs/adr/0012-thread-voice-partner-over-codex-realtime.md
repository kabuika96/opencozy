# ADR 0012: Thread Voice Partner over Codex Realtime

## Status

Superseded by ADR 0013

## Context

Opencozy needs a live voice collaborator that shares a Thread with the user and can delegate implementation work without creating a hidden second history. The public OpenAI Realtime WebRTC integration requires a Platform API key and separate API billing. Codex app-server 0.145 exposes an experimental Thread-scoped Realtime v3 integration that authenticates through the existing Codex ChatGPT sign-in, includes Codex Thread startup context, and turns voice handoffs into ordinary Codex Turns.

Realtime audio and model events are ephemeral, while Opencozy's durable product model is an append-only Timeline of normalized Thread and Run events.

## Decision

Voice Partner uses Codex app-server `thread/realtime/*` v3 through the Codex Harness Adapter.

The PWA captures microphone audio and owns the WebRTC peer connection. It sends only its SDP offer to a Opencozy voice-session endpoint and applies the returned SDP answer. Audio does not pass through Opencozy HTTP routes or SQLite.

The backend asks app-server to include Thread startup context and seeds the session with the Voice Partner role plus recent persisted voice transcript items. Completed user and assistant transcripts become normalized Timeline Events with `source: voice`.

A Realtime handoff starts a normal Opencozy Run. Subsequent Codex Turn, item, subagent, approval, input, and terminal notifications use the existing Codex event mapper and persistence path. Codex responses are returned to the voice conversation in the commentary channel so the Voice Partner can react to ongoing delegated work.

Only one voice session may attach to a Thread. A normal Run cannot start while Voice Partner is active, but the composer may append typed text to the voice conversation. Browser Thread changes and shell teardown stop the media session.

This path uses Codex's existing ChatGPT authentication and plan allowance. Opencozy does not introduce a Platform API key fallback. If the experimental app-server capability becomes unavailable, Voice Partner fails closed with a visible error; the normal text Harness remains available.

## Consequences

Voice Partner and delegated Codex work share one durable Thread rather than diverging into parallel histories. The user can read and respond to normal Codex output, subagents, approvals, and input requests while voice remains conversational.

Audio latency stays on the direct WebRTC path, and Opencozy stores no audio. Subscription reuse depends on an experimental Codex app-server protocol and may require adapter updates when Codex changes it. Voice usage follows ChatGPT/Codex plan allowances rather than OpenAI Platform API billing.
