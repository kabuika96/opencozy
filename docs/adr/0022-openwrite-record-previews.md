# ADR 0022: OpenWrite Records in the Shared File Viewer

## Status

Accepted

## Context

OpenWrite manages the owner's records. Its active runtime is the household records HTTP API, described in OpenWrite ADR 0013. The former Jarvis Markdown vault is retained migration input, not a synchronized store. Opencozy should find and present records using its existing durable file cards and full-screen viewer.

## Decision

Add a read-only backend adapter to the loopback OpenWrite records API. Configure `LITEHARNESS_OPENWRITE_ORIGIN` when needed; the default is `http://127.0.0.1:8787`. Reject remote origins, credentials, and redirects. Opencozy does not expose a generic OpenWrite proxy or change OpenWrite listeners, records, metadata, lifecycle state, or extraction artifacts.

`files.search_records` searches the live household library, with active records by default and an explicit status filter for archived/invalid records. `files.show_record` retrieves the chosen original, verifies its size and SHA-256 against the record, and publishes it through the same Device-owned asset snapshot path as ordinary shared files. Native tools and the existing Run-capability CLI provide identical operations; older Harness histories remain intact.

The new boundary lets a local agent explicitly share a selected household record with its user's trusted Opencozy PWA. Record management stays in OpenWrite. The PWA receives only the selected durable snapshot through existing asset grants, not access to OpenWrite's unauthenticated HTTP API. There is no bulk migration or automatic mirroring into Opencozy.

Store source record ID, revision, lifecycle status, status reason, and capture time with the snapshot. Show that provenance in both the chat card and full view. Label lifecycle status as the status when shared, not as current. For current record questions, the Harness searches OpenWrite again. Existing shared copies remain readable and searchable if OpenWrite is offline or the source chat is closed/deleted. An offline search produces an explicit error rather than claiming no records exist. This implementation presents original documents, not mutable OpenWrite metadata editing or derived-content editing.

## Verification

The backend integration test exercises active/all search, checksum validation, status/source preservation, chat publication, and retrieval after OpenWrite goes offline. A mismatched original is rejected without publishing another card. Configuration tests reject nonlocal and credential-bearing origins. The Chromium browser scenario opens an OpenWrite PDF through the existing viewer and checks status, revision, reason, reload persistence, and PDF navigation. The pinned Codex stub probe exercises all six file tools on new and resumed Threads.

An additional isolated check imports the current OpenWrite RecordStore and HTTP server, creates a synthetic HTML record in temporary storage, finds it through this adapter, verifies identical original bytes, and confirms the record revision remains unchanged. It does not access or mutate the user's library.
