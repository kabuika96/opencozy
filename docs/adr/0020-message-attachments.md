# ADR 0020: Thread-owned Message Attachments

## Status

Accepted

## Decision

Upload files before message submission through a binary HTTP endpoint scoped to a Device-local Thread. The backend stores bytes and metadata in UUID directories beside its database, outside the Workspace. Clients send opaque attachment ids with Runs and main/child steering; the API resolves them within the owned Thread. Filename normalization and generated directory names prevent uploads from selecting or overwriting host paths. Downloads require the same Device header and force attachment disposition.

The composer accepts up to ten files, 20 MiB each. Completed draft uploads survive reload; in-progress and failed uploads retain their browser File only for the current session. A failed send restores the selected attachments. Removing a draft selection detaches it; stored files are retained so Harness history and sent messages keep valid references. Automatic garbage collection is deferred.

The pinned Codex 0.153.4 generated UserInput schema supports native localImage input but no generic file part. The adapter sends signature-recognized PNG, JPEG, GIF, and WebP images natively, plus a text manifest of readable local file paths for all files. Other formats remain local file references for the Harness to inspect with tools. The adapter restores original user text and public attachment metadata when Codex echoes main steering, keeping the hidden manifest out of visible history. Text-only request bodies retain their existing Codex input representation.

This uses the existing host trust boundary and adds no external storage provider or public file URLs. It does not guarantee Codex can decode every uploaded format. Data retention and per-file limits are deliberate initial tradeoffs; abandoned draft bytes are not currently reclaimed automatically.

## Verification

API tests exercise byte preservation, ownership, id validation, limits, Run delivery, and history metadata. Adapter tests cover native images, generic file references, and steering echo normalization. Browser tests use an isolated backend to verify selection, removal, draft reload, delivery to a Harness boundary, one durable history entry, and downloading original bytes.

`npm run test:prompt-cache -- --attachments` additionally runs the pinned Codex process against an isolated loopback Responses stub, proving file references and native image bytes reach the model request while warm follow-ups and cold recovery preserve the prior prefix. It does not call a live model or restart Opencozy.

The Chromium mobile upload scenario and existing nine mobile scenarios passed. The installed WebKit engine crashes at launch with a bus error, so real iOS verification remains outstanding.
