# ADR 0007: Project Preview Through Wired Previews

## Status

Accepted

## Context

Opencozy runs from mobile devices, but developer app previews often live on host-local ports such as `127.0.0.1:5173`. A Trusted Device cannot open those URLs directly, and path-mounting arbitrary dev apps under the Opencozy origin can break app routes, assets, hot reload, cookies, redirects, and auth callbacks.

OpenCozy already proved a useful shape: backend-persisted Wired Previews, visible agent wiring work, approval before durable preview changes, and private Tailscale Serve origins backed by a local proxy.

## Decision

Opencozy will implement Project Preview as backend-owned Wired Preview records attached to Threads.

- A Thread may attach one Wired Preview through `threads.wired_preview_id`.
- Wired Previews store a Project Directory, Preview Target, dependency services, Preview Commands, requested published origins, and current Preview Published Origins.
- Preview Manifests are submitted to the backend and require approval before creating or updating Wired Preview data.
- Preview Wiring starts a new visible Codex Thread with a prompt-file instruction. The Thread searches for candidate Project Directories, asks for user confirmation, inspects the app, then submits a Preview Manifest.
- The first Preview Publisher uses Tailscale Serve and a localhost-only Local Preview Proxy. Publishing uses a private port-based HTTPS origin for the target and for explicit browser-direct dependency services.
- The mobile UI opens the attached preview in an iframe when it is openable. Otherwise it shows saved previews, pending manifests, publish/attach/wire actions, and wire-new.

## Consequences

Project Preview remains inside the v1 Tailscale trust boundary and does not add app-level authentication.

Opencozy does not supervise arbitrary preview app processes in this slice. Preview Commands are recovery hints surfaced through visible wiring Threads.

The backend owns published-origin state and proxy restoration. If proxy restoration or Tailscale Serve republish fails, the origin is marked failed instead of hiding the failure in Harness output.

Harness SDK/protocol details still stay behind backend adapters. Preview wiring is visible Harness work, while persistence, publishing, and attachment are Opencozy backend concerns.
