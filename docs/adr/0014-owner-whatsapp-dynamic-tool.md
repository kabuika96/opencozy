# ADR 0014: Owner WhatsApp Dynamic Tool

## Status

Accepted

## Context

The Opencozy owner wants Codex to send them proactive text messages through the locally installed Hermes WhatsApp bridge. A prompt that tells Codex to run `curl` would leak transport details into agent instructions, make recipient selection model-controlled, and bypass the Harness Adapter boundary.

Codex app-server 0.145 exposes experimental client-executed dynamic tools. Hermes exposes a loopback HTTP bridge with `GET /health` and `POST /send`.

## Decision

Opencozy will expose one outbound-only Codex-native tool:

```text
whatsapp.send_message({ message })
```

- The Codex Adapter advertises a `whatsapp` dynamic-tool namespace on `thread/start` and answers app-server `item/tool/call` requests.
- The tool accepts only one non-empty text message of at most 4,096 characters.
- The recipient is fixed by `LITEHARNESS_WHATSAPP_CHAT_ID`; Codex cannot provide or override it.
- A `WhatsAppMessenger` backend boundary owns the Hermes loopback protocol. Its default implementation checks `GET /health`, sends `POST /send`, and reports offline, pairing, HTTP, and bridge errors clearly.
- `LITEHARNESS_WHATSAPP_BRIDGE_PORT` selects the loopback port and defaults to `3000`. The integration does not accept a remote bridge host.
- Opencozy does not add inbound WhatsApp handling, a recipient picker, a PWA messaging endpoint, or transport commands in prompts.

Codex persists dynamic tools in Harness Thread metadata. Harness Threads created with this tool retain it on resume. Codex 0.145 cannot add dynamic tools through `thread/resume`, so older Harness Threads require Context Compaction or a new Opencozy Thread to establish a tool-enabled continuation.

## Consequences

Codex can send a WhatsApp message through a small typed interface without learning the recipient or Hermes HTTP contract. Dynamic-tool started/completed items continue through the existing normalized `tool-call` Timeline path.

Hermes remains responsible for WhatsApp authentication and session lifecycle. An unpaired or disconnected bridge makes the tool fail visibly and suggests `hermes whatsapp`; it does not fail the whole Opencozy backend.

The integration depends on Codex app-server's experimental dynamic-tool protocol. Its request and response mapping must stay covered by adapter tests and be rechecked when the pinned Codex package changes.
