# ADR 0001: Local PWA Baseline With Tailscale Trust Boundary

## Status

Accepted

## Context

Opencozy is a mobile-first control plane for local Harnesses. It needs iPhone-friendly interaction, fast iteration, and access from trusted mobile devices without exposing agent control surfaces on the LAN.

Any device that can reach Opencozy can drive local Harnesses and potentially trigger filesystem or shell-affecting work through those Harnesses. The network boundary is therefore a security decision, not only a development convenience.

## Decision

Opencozy will be a local-first PWA with:

- React, Vite, TypeScript, and Ionic React in iOS mode for the mobile frontend.
- Node, Fastify, and TypeScript for the backend.
- SQLite under `./data` for Opencozy-owned control-plane state.
- Localhost-only dev services by default.
- Tailscale Serve as the intended path for trusted mobile access.
- No LAN binding by default.
- No app-level login, user accounts, or per-device roles in v1.
- Device-local Thread visibility is allowed without becoming an auth layer: each PWA install sends a stable device id so the backend can partition Threads by creating Device.

The frontend dev server listens on `127.0.0.1:5173` by default. The backend listens on `127.0.0.1:8787` by default. Vite proxies `/api` and `/ws` to the backend so Tailscale Serve can publish a single frontend origin.

## Consequences

Trusted Tailscale devices have full owner access to global v1 data such as Wired Previews. Threads are the exception: they are partitioned by creating Device so multiple phones or browser profiles do not see each other's work contexts.

Localhost-only binding intentionally deviates from the usual LAN-accessible local PWA scaffold. That prevents accidental same-network exposure and makes Tailscale the explicit remote-access mechanism.

Ionic React provides iOS-feeling app primitives, but Opencozy owns routing state, viewport behavior, chat/run semantics, and visual design. Opencozy should avoid handing product behavior to Ionic tabs, nested routers, or animated route transitions in the first slice.
