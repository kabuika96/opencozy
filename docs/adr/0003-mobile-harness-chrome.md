# ADR 0003: Mobile Harness Chrome

## Status

Accepted

## Context

Opencozy is controlled primarily from iPhone Safari or an installed PWA. The mobile surface needs to feel close to a powerful local tool without copying terminal UI decoration or becoming a dashboard of cards.

Harnesses already provide execution semantics. Opencozy should make the owner interaction clear: choose a workspace, select a Thread, submit a Run, watch Harness progress, and respond to approvals. The UI should expose that loop with minimal chrome and predictable mobile behavior.

## Decision

Opencozy will use Mobile Harness Chrome as its primary mobile presentation:

- Black full-screen shell, system mono typography, direct touch controls, and restrained borders.
- Ionic React iOS-mode for page, header, content, footer, and mobile primitives where they help.
- A custom stable header and stable bottom composer owned by Opencozy.
- One mobile scroll owner for the Timeline.
- Header Thread Tabs instead of a dashboard setup panel or in-scroll workspace row.
- Turn-shaped Timeline rendering: submitted Runs are right-aligned query bubbles, Harness output is readable answer text, useful status events are small progress rows, and startup lifecycle noise such as `thread.started` and `run.started` is suppressed from the primary timeline.
- The bottom composer remains available while a Run is active. Submitting during an active Run sends a Steering Message that renders as a right-aligned user prompt inside the current Harness Turn.
- Renderer-facing Harness Output Types for `user-prompt`, `assistant-message`, `reasoning`, `execution`, `file-change`, `tool-call`, `web-search`, `todo-list`, `approval`, `lifecycle`, `error`, and `liteharness-waiting`.
- Stable Output Keys so started, updated, and completed observations for the same Harness item update one render entry instead of appending duplicate rows.
- No fake terminal prompt glyphs, green-console styling, decorative command rows, broad route animations, or marketing empty states.

## Consequences

The frontend records `run.submitted` Timeline Events before driving the Harness so reconnects preserve the full Harness Turn. This keeps conversation rendering durable without leaking Harness SDK details into the PWA.

The frontend renders `liteharness-waiting` as an inline Working row at the end of the timeline flow while the Thread is running or Opencozy is waiting for the Harness to produce its first post-submit observation. This is transient shell state, not a persisted Timeline Event and not part of the scrollback.

Future approval flows, settings, and debug surfaces should preserve the same shell contract. A raw terminal or PTY can be added as a fallback/debug view, but it must not become the primary control metaphor.
