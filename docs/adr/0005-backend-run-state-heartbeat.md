# ADR 0005: Backend-Owned Run State With Heartbeat Recovery

## Status

Amended by ADR 0010

## Context

Opencozy runs from a mobile PWA that can be backgrounded, frozen, or resumed after its websocket has gone stale. The Harness work itself must not depend on the PWA staying alive after a Run is submitted.

The existing `liteharness-waiting` row is transient shell feedback. It should reflect backend-owned Run and Thread state, plus a short submit grace period, rather than becoming a durable frontend-owned state machine.

## Decision

Opencozy will treat the backend store as the source of truth for Thread and Run status.

- Run submission marks the Run and Thread running in the backend before the PWA receives the response.
- The backend process tracks active Run ids in memory only to know which persisted active Runs are currently owned by this process.
- Persisted active Runs that are not owned by the current backend process get a short lease grace window. If the local owner PID recorded in the lease is confirmed absent (`ESRCH` from signal 0), recovery releases the Run immediately. Live, unrecognized, or uninspectable owners retain the grace window. After the owner has exited or its lease is stale, the backend marks the Run failed internally and releases the Thread back to idle without appending a Timeline Event.
- Opencozy's service restart script does not tag or delete the calling Thread. Interrupted Runs follow the same stale-lease recovery path as other lost backend work, and the owning Thread is preserved.
- The backend exposes a Thread state snapshot containing server time, the Thread record, and the current Timeline.
- The websocket emits frequent heartbeat messages. Each heartbeat reconciles the subscribed Thread's leases and includes its current status. The PWA fetches snapshots on initial load and connection/focus/online/visibility recovery (ADR 0010), and applies heartbeat status without another snapshot.

## Consequences

Leaving or resuming the PWA no longer leaves the mobile shell dependent on stale local `running` state. If the websocket silently dies, the heartbeat poll refreshes the Timeline from the backend and triggers websocket reconnection after missed heartbeats.

If the backend process dies mid-run, Opencozy cannot assume the Harness execution is still controllable. On the next thread-specific snapshot, websocket heartbeat, or run submission, the orphaned Run is closed internally once its owner is confirmed absent or its lease expires. The Thread becomes idle instead of staying permanently stuck on Working, including when a client reconnects during the grace window. PID reuse can delay recovery until lease expiry but cannot release a fresh lease prematurely.

Intentional restarts, crashes, and unrelated backend replacement all preserve Threads. Any interrupted Run is failed internally once its owner exits or its lease becomes stale, returning its Thread to idle.
