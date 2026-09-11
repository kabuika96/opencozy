# ADR 0017: Preserve Model History for Prompt Caching

## Status

Accepted

## Context

Prompt cache reuse requires the earlier rendered context to match exactly. Opencozy already sends only the latest prompt to Codex, but Run dispatch could compact the visible Timeline and clear the Harness thread id before a follow-up. That replaced the full model history with a summary even though Codex still owned a usable context. The adapter also resumed the thread on every Run and appended the same mobile reply contract to every user message.

## Decision

- New Run submission never invokes Opencozy Context Compaction. Explicit compaction remains available and sends its handoff only when seeding the replacement Harness thread.
- Codex owns earlier messages, assistant output, and tool results. The adapter appends new input without reconstructing, reordering, or supplying replacement history from Timeline Events.
- The adapter remembers loaded thread configurations per connection and reuses the owning connection. Each process is bound to one main thread (ADR 0019). Unchanged warm threads receive `turn/start` directly. Recovery and changed configuration use `thread/resume` by id with `excludeTurns: true`; no replacement `history`, `path`, or dynamic tool definitions are sent.
- The mobile reply contract joins the stable thread developer instructions. New user messages carry only new input and, when explicitly compacted, the initial handoff. Older stored prompts are not rewritten.
- Failed or interrupted connection state is discarded. Thread configuration, including the selected Execution Profile and Fast setting, still applies to subsequent turns.
- If a warm `turn/start` explicitly rejects an unloaded thread before accepting input, the adapter resumes that same id and retries once. Ambiguous transport failures and timeouts are never retried automatically.

## Verification

Regression tests check that new submissions above the former compaction threshold retain the Harness id and byte-identical previous Timeline entries, warm follow-ups avoid repeated resume calls, and recovery, failed startup, profile changes, and pool preference work correctly.

`npm run test:prompt-cache` runs an isolated Responses stub with the pinned Codex app-server and verifies that the previous request input is a byte-identical JSON prefix of the next request, both warm and after restarting the probe process. It also compares prompt-relevant settings, instructions, tools, and the cache key. No live model request or WhatsApp delivery is made by this probe.

## Consequences

Ordinary follow-ups preserve an increasing reusable prefix. Explicit compaction, model/configuration changes, missing Harness history, or Harness-native compaction can change that prefix. Provider cache retention and routing remain outside Opencozy's control; this change does not guarantee a cache hit or a particular latency/cost improvement.

Sources: [OpenAI prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching), [Codex app-server](https://developers.openai.com/codex/app-server).
