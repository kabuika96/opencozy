# ADR 0016: Native Mobile Shell

## Status

Accepted. Supersedes the Ionic primitive choices in ADRs 0001 and 0003; their product and trust boundaries remain in force.

## Context

Opencozy used five Ionic layout wrappers but owned navigation, controls, viewport geometry, and Timeline behavior itself. The Ionic React entry registers its entire component catalog, so named imports cannot remove unused components. A production build measured a 262.5 KB gzip entry; an isolated package-chunk experiment measured Ionic at 230.9 KB gzip. Chunk compression is not additive, but the experiment identifies the dominant avoidable dependency.

The Ionic content wrapper also hid the actual Timeline scroller behind an asynchronous shadow-DOM API, complicating viewport and reading-position ownership.

## Decision

- Use native React elements for the app, page, header, main scroller, and footer. Remove Ionic React, its initialization, and its global styles.
- Preserve the existing visible-viewport geometry, safe-area insets, stable header and composer, and native-feeling controls. Explicit local base styles replace the framework resets.
- Give the Timeline hook a direct reference to its native scrolling element. There is one scroll owner per visible content surface; overlays own only their internal overflow.
- Retain React and the existing normalized Harness adapter boundary. This change adds no UI framework or routing dependency.
- Verify transcript following, reading position across tab switches, keyboard resizing/dismissal, overlays, and agent navigation in browser tests. Keep an explicit WebKit test command; an unavailable browser engine is a recorded validation gap rather than a successful test.

## Consequences

The production frontend no longer loads an unused mobile component catalog. Layout and scrolling are inspectable in ordinary DOM tools, and their behavior is maintained by small focused hooks. Opencozy now owns its base mobile styles; real iOS keyboard and safe-area behavior still require on-device verification.
