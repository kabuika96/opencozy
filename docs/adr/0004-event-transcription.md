# ADR 0004: Event Transcription

## Status

Superseded by ADR 0010

## Context

Codex SDK events are accurate but too raw for a mobile control plane. Commands, tool calls, file-change payloads, and status lifecycle events need concise, scan-friendly wording that can carry color, code, and small graphics without making the frontend understand every Harness-specific payload shape.

OpenWrite already uses a ChatGPT Codex Responses-compatible model provider authenticated by local ChatGPT sign-in token reuse rather than an OpenAI API key. Opencozy can use the same provider style for its own model-owned backend features.

## Decision

Opencozy will add an Event Transcription layer after Harness Adapter mapping and before Timeline Event persistence.

Each persisted Harness event may include `payload.transcript` with:

- `action`: one-line mobile action text.
- `resultSummary`: one-line mobile result text.
- `actionHtml`: constrained event HTML for the action line.
- `resultHtml`: constrained event HTML for the result line.
- `source`: `model` or `fallback`.

The v1 Opencozy Model configuration only supports ChatGPT Codex Responses-compatible calls:

- Endpoint default: `https://chatgpt.com/backend-api/codex/responses`.
- Token source: `LITEHARNESS_CHATGPT_TOKEN` or `LITEHARNESS_MODEL_TOKEN`, then `LITEHARNESS_CHATGPT_AUTH_STORE`, then local Codex/Hermes auth stores.
- Default Opencozy Model: `gpt-6-astra`.
- Default transcription reasoning effort: `xhigh`.

If the token, endpoint, or model response is unavailable, Opencozy writes a deterministic fallback transcript. Harness execution must never fail just because transcription failed.

## Consequences

The mobile UI reads Event Transcripts first and falls back to deterministic presentation for older Timeline Events. Structured events render in a thread-style rail where the Event Transcript action is the event title and the result summary is the subtitle. Raw Harness payloads remain stored so expanded rows and diagnostics can still show commands, output, file lists, tool errors, and original text.

Event HTML is not arbitrary HTML. The frontend sanitizes it to a small allowlist for colored text classes, code, and inline SVG graphics. Scripts, style attributes, external media, links, forms, and event handlers are stripped.

This keeps model-owned rewriting outside Harness Adapters. Future Harnesses can emit raw events normally and still benefit from Opencozy-owned mobile transcription.
