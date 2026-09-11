# ADR 0015: Reversible Tabs and One Mobile Viewport

## Status

Accepted

## Context

Closing a tab previously deleted its Thread and required a menu plus confirmation. The large mobile shell combined navigation, transcript scrolling, and keyboard geometry. Global touch cancellation swallowed quick successive controls; document-level scroll listeners and scrollIntoView could move more than the Timeline.

## Decision

- Add an additive `closed_at` SQLite field. UI close archives idle Threads without deleting Runs, Timeline Events, Harness context, or preview attachments. A bulk close request scopes explicit IDs to the owning Device and reports skipped active Threads. Reopen restores the same Thread; the existing permanent DELETE route remains separate.
- Bulk close commits the eligible set in one transaction. Stop and close all is a distinct confirmed action that waits for Run cleanup; failed or incomplete interruptions leave those Threads open.
- Extract viewport, Timeline scrolling, tab controls, and Agent Timeline navigation into focused modules. The visible viewport sets shell geometry; composer measurement sets jump-button placement.
- Follow streamed output only while the reader is at the end. Save each Thread/Agent Timeline reading position. Scroll only the Timeline element, never the document.
- Keep browser input composition intact and provide explicit keyboard dismissal. Opening tab options does not focus Rename. Escape dismisses overlays and focused editing before interrupting an active Run.
- Preserve the localhost/Tailscale trust boundary and Codex Harness Adapter. Agent messages must target verified child membership through the adapter; the frontend never issues protocol requests.
- Directed child steering uses pinned Codex `turn/steer` with the observed child `expectedTurnId`. Verify protocol shapes using `codex app-server generate-ts` from the installed package; no inference run is needed. Finished agents remain inspectable; their follow-up work belongs to Main.

## Consequences

Closing is immediate and recoverable. Closed Threads still occupy storage deliberately; this change does not garbage-collect user history. Mobile keyboard behavior receives deterministic viewport tests plus browser checks; real iOS keyboard behavior still merits device validation.
