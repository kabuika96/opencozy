# Project Preview

Project Preview lets an enrolled phone or tablet view a developer app connected to an OpenCozy Session. Preview setup is stored as a backend-owned Wired Preview so it can be reused from any enrolled device.

Project Preview is not deployment and is not public sharing. Preview targets and published origins stay inside the trusted private boundary.

## Model

- A Wired Preview is a named backend record for one user-confirmed Project Directory.
- A Wired Preview contains one Preview Target, optional Preview Dependency Services, optional Preview Commands, requested private origins, and published origin state.
- The active Wired Preview attachment belongs to the shared OpenCozy Session. It is not a device-local tab preference.
- Closing a Session Tab does not delete, detach, or unpublish a Wired Preview.
- The Project Preview page opens the attached Wired Preview first. If no preview is attached, it shows searchable Wired Previews and a Wire New Preview action together.
- Wired Previews are global OpenCozy data. Any enrolled device can search and attach them.

## Opening A Preview

1. Open an OpenCozy Session.
2. Tap the Preview control.
3. If the session already has an attached Wired Preview, OpenCozy opens it immediately.
4. Tap the preview edit control to change the attachment, search existing Wired Previews, or wire a new one.

The iframe URL comes from the attached Wired Preview:

- If a published target origin exists, OpenCozy opens that private HTTPS origin.
- Otherwise, OpenCozy opens the stored target URL directly. This is the manual LAN path and only works when the enrolled device browser can reach that URL.

OpenCozy no longer stores per-device raw preview URLs in browser localStorage.

## Direct LAN Targets

The vendor-neutral path is still a directly reachable target URL. Use it when the phone and the Codex Host can reach the developer app on the same trusted network.

For this path:

- Start the developer app so it listens on a LAN-reachable host if needed, such as `0.0.0.0`.
- Make sure the phone can open the target URL in Safari.
- Use Wire New Preview so the visible Preview Wiring Session records that URL in a Preview Manifest.
- Approve the manifest. The target URL becomes durable backend data on the Wired Preview.

Do not use `localhost`, `127.0.0.1`, `::1`, or `0.0.0.0` as the browser-facing Direct LAN target for a phone. Those addresses are local to the browser device or non-routable as a destination. OpenCozy treats them as needing a private published origin before auto-opening the preview frame.

Do not use Project Preview to expose every local service by default. Only record browser-facing targets and browser-direct dependency services that the app actually needs.

## Tailscale Publisher

For enrolled devices away from the LAN, the first Preview Publisher uses Tailscale Serve with private HTTPS ports.

The published target shape is:

```sh
tailscale serve --bg --https=<published-port> http://127.0.0.1:<local-proxy-port>/
```

OpenCozy stores the resulting Preview Published Origin on the Wired Preview. The developer app owns `/` on that private HTTPS port, which avoids path conflicts with routes, assets, auth callbacks, cookies, redirects, and hot reload paths.

Tailscale Serve points at an OpenCozy-owned Local Preview Proxy, not directly at the developer app. The Local Preview Proxy binds only to `127.0.0.1`, forwards to the stored target origin, and rewrites the request shape so local development servers see the expected local host header. This avoids requiring framework-specific patches such as adding the tailnet hostname to Vite `server.allowedHosts`.

Unpublishing is explicit:

```sh
tailscale serve --https=<published-port> off
```

Port allocation is controlled by:

- `OPENCOZY_PREVIEW_PUBLISH_PORT_START`, default `8443`
- `OPENCOZY_PREVIEW_PUBLISH_PORT_END`, default `8499`
- `OPENCOZY_PREVIEW_PROXY_PORT_START`, default `19000`
- `OPENCOZY_PREVIEW_PROXY_PORT_END`, default `19999`

The publish port is the browser-facing HTTPS port. The proxy port is a separate localhost-only implementation detail. If the planned proxy port is already occupied, OpenCozy should try another proxy port in the configured range and update the Tailscale Serve target. On backend startup, OpenCozy should restore local preview proxies for published origins and re-point Tailscale Serve when a persisted proxy port had to be reassigned.

Tailscale publishing requires:

- The Codex Host is enrolled in Tailscale.
- Tailscale Serve and HTTPS certificates are enabled for the tailnet.
- `OPENCOZY_TAILSCALE_SOCKET` is set when OpenCozy uses a non-default Tailscale daemon socket.
- `OPENCOZY_ALLOWED_HOSTS` includes the OpenCozy origin hostnames used by the browser.

See [private-wan-agent-setup.md](private-wan-agent-setup.md) for OpenCozy WAN setup.

## Dependency Services

Most Preview Dependency Services should stay host-local. The browser should reach only the Preview Target unless the target app architecture requires browser-direct calls to another local service.

If a service is marked browser-direct, OpenCozy can publish it as a separate private HTTPS origin. Each browser-direct dependency service gets its own port-based Preview Published Origin. Host-local services are not published by the bulk dependency publish action.

## Wire New Preview

Wire New Preview starts a visible Preview Wiring Session. This is intentionally not hidden background scanning.

The user provides a Project Search Brief, such as a project name or details. The Preview Wiring Session should:

1. Search the Codex Host for candidate project directories.
2. Ask the user to confirm the intended Project Directory.
3. Inspect the confirmed project.
4. Ask before running project commands.
5. Identify the Preview Target and any dependency services.
6. Submit a Preview Manifest to the local OpenCozy backend.

OpenCozy must launch Codex with a short initial prompt argument that points to a local prompt file containing the full wiring instructions. Do not queue or auto-type OpenCozy-authored preview prompts through the WebSocket terminal input path after the PTY starts; that path is reserved for user input. New, update, and recovery wiring actions should start a visible Preview Wiring Session with the launch prompt already passed to Codex. For updates, reuse the backend Wired Preview data as context in the prompt file and replace the Wired Preview's latest `wiringSessionId` with the newly launched visible session.

## Preview Manifests

A Preview Manifest is a structured proposal for preview wiring. It can create a new Wired Preview or update an existing one.

Approval is required before OpenCozy persists material preview changes, including:

- Wired Preview name
- Project Directory
- Preview Target
- Preview Dependency Services
- Browser-direct flags
- Preview Commands
- Requested or published origins

Codex may propose a name, but the user confirms or edits it before approval. Unchanged resubmissions may be treated as already approved.

## Preview States

Project Preview shows state labels so stale or incomplete records are still useful.

- Ready: the target is stored and can be attached or opened.
- Needs start: stored Preview Commands may be needed to start or repair the app. The action returns to the visible Preview Wiring Session.
- Needs publish: the target or browser-direct dependency services need private HTTPS origins.
- Unreachable: the last reachability check failed or the target is likely stale. Return to the Preview Wiring Session to repair it.
- Manifest pending approval: a newer manifest is waiting for user review.

These states describe likely next actions. They are not an app deployment status.

## No Hidden Command Execution

OpenCozy must not run arbitrary project commands invisibly from the Project Preview UI.

Preview Commands are metadata and recovery hints. Start and recovery actions open a visible Preview Wiring Session with the relevant context. The wiring session should ask before running commands, and the user should be able to observe or interrupt the work.

If OpenCozy needs to provide new recovery context, it should create a new visible Preview Wiring Session using Codex's process initial prompt rather than injecting text into an already-running PTY.

The Preview Publisher is the exception: OpenCozy may run the narrow backend-owned `tailscale serve` publish and unpublish commands because those commands create or remove Preview Published Origins, not developer app processes.

## iPhone Validation

Validate Project Preview on an actual enrolled iPhone before marking a release slice complete:

- Open OpenCozy through the private HTTPS OpenCozy origin.
- Search for an existing Wired Preview and attach it to a session.
- Start Wire New Preview and observe the Preview Wiring Session.
- Approve a submitted Preview Manifest.
- Open an approved target through a Tailscale Serve Preview Published Origin.
- If the app requires one, verify a browser-direct dependency service through its own private HTTPS origin.
- Confirm Preview State labels and recovery actions are understandable on the phone.

Record failures in the relevant issue before changing the network model.
