# Repository prompt audit — 2026-09-06

This historical audit covered application prompts and separately installed developer skills. External skill inventories, machine paths, and private audit artifacts are excluded from the public repository; those external checks cannot be reproduced from this checkout.

## Repository findings

- Mobile replies retain material uncertainty, requested detail, and verification status.
- Execution profile instructions defer to session delegation and model restrictions.
- Compaction distinguishes completed work from unverified progress, preserves steering and scoped approvals, and avoids inventing constraints.
- Preview wiring reuses confirmed directories and preserves explicit manifest approval.

## Recorded verification

At the time of the audit, `npm run check` passed 100 backend and 103 frontend tests, both type checks, and both builds. `npm run test:prompt-cache` verified warm follow-up and cold-recovery request prefixes against a local stub without a live model call. These are dated results, not a statement about the current checkout.

Application prompt changes load at backend startup. A restart interrupts active Runs and requires the operator's approval; it preserves existing history. See [ADR 0018](../adr/0018-explicit-action-approval-cards.md) and [ADR 0017](../adr/0017-preserve-model-history-for-prompt-caching.md).
