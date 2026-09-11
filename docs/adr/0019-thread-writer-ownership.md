# ADR 0019: Pin main threads to app-server writer processes

## Status

Accepted; amends ADR 0009 and ADR 0017.

## Context

The pinned Codex 0.153.4 app-server retains a thread's writer lock even between turns. Previously the pool could load multiple main threads into one process. When that process was leased to thread A, a concurrent follow-up for thread B resumed B on a second process and failed with `thread ... already has an active writer`. Seven matching failures were observed on 2026-09-10, and an isolated two-process probe reproduced the exact rejection.

## Decision

Bind each app-server connection to one main Harness thread, including threads created before their first Run. Only unbound warmed connections may serve a new thread. Follow-ups acquire the owning connection by Harness thread id; duplicate concurrent acquisition of that same thread is rejected. Separate main threads can run concurrently. Child threads remain inside their parent's process and adapter notification stream.

Retain at most two idle connections. Discard failed, dead, or excess idle connections, but keep their ownership recorded until process exit has completed. A subsequent acquisition waits for that exit before resuming persisted history elsewhere. No lock stealing, automatic Run resubmission, or history replacement is involved.

## Consequences

New threads may incur process startup rather than sharing an already-bound idle process. Warm follow-ups preserve their context and prompt prefix. Cold recovery and explicit configuration changes still resume history by id. Process concurrency remains proportional to active Runs, plus the bounded idle pool. Existing live processes require an approved backend restart to load this change.

## Verification

Adapter regression tests create two threads, keep the first Run active, and complete a Run and follow-up on the second. Pool tests cover ownership, simultaneous acquisition, idle limits, and delayed process exit after failure, eviction, or death. `npm run test:writer-isolation` uses the pinned binary against a loopback Responses stub; the prompt-cache probe checks warm and cold request-prefix preservation.
