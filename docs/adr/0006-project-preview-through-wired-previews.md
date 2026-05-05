# Project Preview Through Wired Previews

Status: Accepted

Date: 2026-05-05

OpenCozy will replace device-local preview URLs with user-named, backend-persisted Wired Previews that can be reused from any Enrolled Device and attached to shared OpenCozy Sessions. A Wired Preview starts from a user-confirmed Project Directory, includes one Preview Target plus any required Preview Dependency Services, and is created or updated through a visible Preview Wiring Session rather than hidden agent work or deterministic project scanning. The wiring session may begin from a user-provided Project Search Brief, search the Codex Host for candidate project directories, and ask the user to confirm the intended Project Directory before wiring. OpenCozy launches wiring work by passing Codex a short process initial prompt that points to a local prompt file with the full instructions; it does not queue or auto-type OpenCozy-authored preview prompts through terminal WebSocket input after the PTY starts. The wiring session may submit a structured Preview Manifest directly to the local OpenCozy backend, but OpenCozy persists or publishes it only after user approval.

Preview Published Origins should be private, HTTPS, and port-based so each published frontend or browser-direct dependency service owns `/`. Path-mounted previews are rejected because they can conflict with app routes, assets, auth callbacks, cookies, redirects, and development server hot reload paths. Arbitrary subdomains are not the first path because plain Tailscale Serve is naturally device-name and port oriented; Tailscale Services may support named service origins later, but require tailnet service setup and are too heavy for the first OSS flow.

The OpenCozy backend owns Wired Preview persistence and Preview Publisher state. The first Preview Publisher may use Tailscale Serve plus an OpenCozy-owned Local Preview Proxy for port-based private HTTPS origins; the Vendor-Neutral LAN Path remains available through manually reachable preview URLs until a LAN publisher is explicitly designed.

The first Tailscale Serve publisher stores Published Origin state directly on the Wired Preview. Publishing the frontend target uses `tailscale serve --bg --https=<published-port> http://127.0.0.1:<local-proxy-port>/`. The browser still opens the developer app at `/` on the private HTTPS port, while the Local Preview Proxy forwards to the target origin with local request headers so development servers such as Vite do not need per-preview `allowedHosts` patches. Unpublishing uses `tailscale serve --https=<published-port> off` and is explicit. Browser-direct dependency services use the same port-based shape but are represented as dependency-service Published Origins, one origin per marked service. Failed publish attempts are represented as failed Published Origin state with an error message.

The published HTTPS port and the local proxy port are intentionally separate. Published HTTPS ports are chosen from the Preview Publisher port range. Local proxy ports are chosen from a separate localhost-only proxy range. If the preferred local proxy port is already occupied, OpenCozy should try another proxy port and update the Tailscale Serve target. On backend startup, existing published origins should restore their Local Preview Proxy and re-point Tailscale Serve if the persisted local proxy port had to change.

Consequences:

- Preview configuration moves from browser localStorage to OpenCozy backend storage.
- Session tabs can search for existing Wired Previews or launch a visible Preview Wiring Session to create a new one.
- The active Wired Preview attachment belongs to the shared OpenCozy Session, not device-local Session Tab Preferences.
- Closing an OpenCozy Session or Session Tab does not detach, delete, or unpublish a Wired Preview; detach is an explicit preview-settings action.
- Project Preview opens the attached Wired Preview first when one exists; otherwise it shows searchable Wired Previews and a wire-new action together, keeping wire-new available when search has no results.
- Wired Preview search shows durable records even when they are stale or unpublished, with explanatory Preview State labels and likely next actions.
- Codex may propose a Wired Preview name through the Preview Manifest, but the user confirms or edits it before approval.
- Dependency services stay host-local by default, but browser-direct dependency services may receive their own private HTTPS Preview Published Origin when the app architecture requires it.
- Preview wiring may run project commands and inspect messy app structures, but it happens in a visible OpenCozy Session so the user can observe and interrupt it.
- Existing backend Wired Preview data should be reused as prompt-file context for Wired Preview updates when available, while each OpenCozy-authored wiring instruction starts in a new visible Preview Wiring Session through Codex's process initial prompt.
- Preview Manifests give Codex a structured local submission path without silently mutating global preview state.
- Approval is required for material manifest changes; unchanged resubmissions can be treated as already approved and reused.
- Preview Commands may be stored as metadata, but OpenCozy will not supervise arbitrary app processes in the first Project Preview implementation.
- Preview State can suggest using stored Preview Commands or returning to the Preview Wiring Session to recover an unreachable preview.
- Start/recovery actions open a visible Preview Wiring Session with the relevant commands ready as context, rather than executing them invisibly from the Project Preview UI or injecting prompts into an already-running PTY.
- The first Preview Publisher reports and persists target publish state and browser-direct dependency-service publish state; host-local dependencies are not published by default.
- Tailscale Serve should target the OpenCozy Local Preview Proxy, not the developer app directly, so app path ownership is preserved without requiring framework-specific host allowlist changes.

References:

- [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)
- [`tailscale serve` CLI](https://tailscale.com/docs/reference/tailscale-cli/serve)
- [Tailscale Services](https://tailscale.com/kb/1552/tailscale-services)
