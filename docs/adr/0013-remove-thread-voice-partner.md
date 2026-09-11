# ADR 0013: Remove Thread Voice Partner

## Status

Accepted

## Context

ADR 0012 depended on Codex app-server's experimental Realtime v3 path. Opencozy could receive an SDP answer before Codex's sideband connection was usable, leaving the UI reporting a live microphone while spoken and typed input produced no response. ChatGPT-authenticated upstream joins also failed, and `thread/realtime/appendText` did not guarantee a response.

A separate OpenAI Platform Realtime integration would require API billing, which is outside the product requirement for this feature.

## Decision

Remove Voice Partner from Opencozy.

- Remove the microphone control, browser WebRTC code, and voice-specific composer behavior.
- Remove voice HTTP routes, Harness capabilities, session types, and Codex Realtime adapter code.
- Do not add a paid Platform API fallback.
- Keep ordinary Codex Runs and active-Run steering as the only conversation paths.

## Consequences

The mobile shell no longer presents a control that can claim to be live without a usable conversation. Typed prompts retain the normal durable Run and Steering Message behavior.

ADR 0012 is superseded. A future voice feature requires a reliable, testable transport that satisfies the no-incremental-billing constraint.
