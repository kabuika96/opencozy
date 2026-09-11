# ADR 0008: Device-Local Thread Visibility

## Status

Accepted

## Context

Opencozy is single-user software with Tailscale as the network trust boundary, but the mobile control plane may be opened from more than one trusted phone, tablet, or browser profile.

Sharing one Thread list across those Devices makes active work contexts bleed between surfaces. It also lets one Device accidentally steer, close, rename, or attach previews to another Device's Thread.

## Decision

Opencozy will make Threads Device-local.

- The PWA creates a stable Opencozy device id in browser local storage.
- The PWA sends that id on HTTP requests with `x-liteharness-device-id`.
- The PWA sends the same id on timeline websocket subscriptions as `deviceId`.
- The backend stores `owner_device_id` on Threads and filters Thread list, state, timeline, Run, steering, input, rename, close, compaction, preview attachment, and websocket subscription routes by that owner.
- Thread title uniqueness is scoped to the creating Device.
- Pre-existing unowned Threads are adopted by the first upgraded Device that lists Threads.

## Consequences

Devices no longer see or operate on each other's Threads through normal Opencozy routes.

This is not a user account or authorization system. A Trusted Device remains trusted at the Tailscale boundary, and backend-owned global data such as Wired Previews remains shared.

Harness SDK and protocol details remain behind Harness Adapters; device ownership is a Opencozy Thread routing concern.
