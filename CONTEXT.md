# OpenCozy

OpenCozy is a secure PWA for running Codex from a phone while Codex stays on a separate computer you control. It exists to provide a mobile interface to Codex without turning into a general-purpose remote shell. Access may be local, LAN, or Private WAN, but every path must stay inside a trusted private boundary.

## Language

**Codex Host**:
The user-controlled computer that runs the OpenCozy backend and starts Codex processes.
_Avoid_: server, remote machine

**Enrolled Device**:
A user-controlled phone, tablet, or computer explicitly admitted to the private connectivity boundary for OpenCozy. An Enrolled Device may reach OpenCozy away from the LAN, but it is not an anonymous browser or a public visitor.
_Avoid_: public client, internet user

**Private WAN Access**:
Remote OpenCozy access for Enrolled Devices through an authenticated device-network boundary. Private WAN Access extends the trusted-device model beyond the LAN, but it is not public internet exposure and does not make OpenCozy safe to expose without that boundary. The first Private WAN Access trajectory should use device-network enrollment rather than putting OpenCozy behind a public URL with identity login.
_Avoid_: public URL, internet deployment

**Developer OpenCozy Origin**:
The Vite developer server acting as the single browser-facing OpenCozy Origin during direct LAN and Private WAN Access use. Because OpenCozy is a developer-mode tool, this origin may remain Vite-based as long as the backend stays localhost-only behind it for WAN access and accepted hostnames are explicit.
_Avoid_: production server, hardened gateway

**Network-Agnostic PWA**:
The OpenCozy frontend should behave the same whether the OpenCozy Origin is reached on LAN or through Private WAN Access. Network reachability is configuration and documentation, not a separate in-app mode.
_Avoid_: remote mode UI, LAN mode UI

**Vendor-Neutral LAN Path**:
The no-vendor access path where a phone or tablet reaches the Codex Host directly on the same trusted local network, without requiring a third-party overlay network or hosted service. This path must remain available even when Private WAN Access docs or helpers exist.
_Avoid_: legacy mode, fallback mode

**OpenCozy Origin**:
The single browser-facing origin that serves the PWA and proxies OpenCozy API and WebSocket traffic to the backend. In Private WAN Access mode, Enrolled Devices should reach only this origin; the backend should remain bound to localhost behind it.
_Avoid_: separate backend URL, exposed API port

**OpenCozy Session**:
An active PTY process started by OpenCozy to run Codex and stream terminal I/O to the PWA.
_Avoid_: shell session, terminal session

**OpenCozy Session Name**:
Shared backend metadata for an OpenCozy Session, shown by every device that has that Session open in a Session Tab. The backend should source it from the linked Codex Session title unless the user explicitly renames the OpenCozy Session. A new OpenCozy Session may link to a Codex Session only after the PTY submits a non-empty first prompt and Codex records a matching `first_user_message`; it must not adopt the globally latest Codex thread for the cwd. A resumed OpenCozy Session may link through an explicit device-scoped Codex thread id, the visible Resume Picker selection, or exactly one updated Codex rollout containing a post-resume user message submitted through that OpenCozy PTY.
_Avoid_: tab label preference, device title

**Session Tab**:
A device-local PWA attachment to one active OpenCozy Session. Session Tabs keep their terminal panes mounted while inactive so their sockets can keep receiving PTY output, but switching tabs must not create, close, or resume Codex work by itself. The backend remains the owner of OpenCozy Session lifecycle; closing a Session Tab is an explicit request to close that OpenCozy Session.
_Avoid_: Codex conversation tab, history item

**Session Tab Preferences**:
Per-device PWA storage for which Session Tabs are open and which Session Tab is active. These preferences must never use global "last session" keys and must never be inferred from another device's latest OpenCozy Session. They can reference shared OpenCozy Sessions by id, but the open-tab list and active-tab choice belong only to the current device. A backend OpenCozy Session list may include another device's OpenCozy Session only when this device already has that session id in its Session Tab Preferences.
_Avoid_: global last session, host session state

**Codex Session**:
A conversation recorded and resumed by the Codex CLI itself.
_Avoid_: OpenCozy session

**Resume Picker**:
The interactive `codex resume` UI owned by the Codex CLI.
_Avoid_: session manager

**Mobile Terminal Surface**:
The phone-first terminal UI that renders and controls a Codex-owned PTY. It should preserve terminal capabilities because Codex assumes it is running in a terminal, but active text entry should feel native on mobile: visible insertion point, predictable selection, paste, and keyboard-driven caret movement. Selection should work across output, prompts, and the active input line. Starting text selection during streaming should pause auto-scroll just like manual scrolling, and auto-scroll should remain paused after selection ends until the user explicitly returns to bottom with a floating down-chevron control. The floating return-to-bottom control should appear whenever the viewport is away from bottom, not only while output is streaming. Active prompt editing may be single-line in terminal semantics, but long text should wrap visually and support iOS-like caret movement across wrapped visual lines. Keyboard Return submits by default. Taps in the input zone should focus the iOS input bridge; taps elsewhere should remain available for terminal interaction such as selecting Codex picker or menu items through terminal-native mechanisms, not Codex-specific screen parsing. Arrow and Enter controls should remain visible across native keyboard focus states, without an extra explanatory status hint. The input zone should not need a special visual hint; the terminal-rendered caret should signal active editing. Copied text should be normalized for readability by cleaning up terminal layout artifacts such as soft wraps and cell padding, while keeping selected content otherwise intact. Paste should behave like ordinary iOS text input through the input bridge, without a special OpenCozy paste button or confirmation prompt. Terminal-rendered state remains the source of truth; iOS-native input is an input method and gesture model, not the visible prompt owner. It is still scoped to Codex rather than becoming a general-purpose remote shell.
_Avoid_: chat renderer, Codex transcript renderer

**Mobile Xterm Fork**:
An OpenCozy-maintained xterm variant used only by the Mobile Terminal Surface when stock xterm's public API is too desktop-oriented for phone-first interaction. It should live inside this repo as its own workspace package, keep xterm's terminal emulator core, and expose narrow mobile hooks for touch hit testing, selection, composition/input, cursor movement, viewport state, and renderer feedback. Desktop terminal views should stay on stock xterm unless they need the same mobile interaction hooks.
_Avoid_: app overlay hack, custom terminal engine

**Mobile Terminal Preferences**:
Per-device app settings that tune the Mobile Terminal Surface without changing Codex conversation state. The first preferences are iOS autocorrect and autocapitalization for the native input bridge, both enabled by default and independently disableable.
_Avoid_: session settings, Codex settings

**Project Preview**:
A per-session OpenCozy surface for viewing a Wired Preview from an Enrolled Device.
_Avoid_: LAN app shortcut, deployment, public preview

**Project Directory**:
The user-confirmed directory on the Codex Host that contains the developer app for a Wired Preview.
_Avoid_: inferred repo, global workspace

**Project Search Brief**:
A user-provided description of the project name or details used to find a Project Directory.
_Avoid_: guessed path, global recency

**Wired Preview**:
A user-named backend-persisted preview configuration for a Project Directory, including the target frontend and its required local dependency services, that can be reused from any Enrolled Device.
_Avoid_: device preview URL, tab-local preview

**Preview Wiring Session**:
A user-visible OpenCozy Session launched for a Project Directory to create or update a Wired Preview.
_Avoid_: hidden agent work, deterministic project scanner

**Preview Target**:
The target frontend entry point for a Wired Preview.
_Avoid_: exposed app port, arbitrary URL

**Preview Dependency Service**:
A local service the Preview Target needs in order to work correctly.
_Avoid_: exposed backend port, public service

**Preview Published Origin**:
The private browser-facing origin an Enrolled Device opens to view a Wired Preview. It is backend-owned state on the Wired Preview and records provider, source, HTTPS port, local proxy port when applicable, published URL, status, and any failure message.
_Avoid_: public URL, path shortcut

**Preview Publisher**:
The OpenCozy backend component that creates, updates, and removes Preview Published Origins for Wired Previews.
_Avoid_: manual tunnel command, agent-owned tunnel

**Local Preview Proxy**:
A localhost-only OpenCozy proxy owned by the Preview Publisher that lets a Preview Published Origin stay root-mounted while forwarding to the developer app with local request headers.
_Avoid_: path-mounted proxy, app config patch

**Preview Manifest**:
Structured preview wiring produced for user approval before OpenCozy persists or publishes a Wired Preview.
_Avoid_: silent agent registration, free-form instructions

**Preview Command**:
A structured command hint needed to start or maintain part of a Wired Preview.
_Avoid_: managed process, OpenCozy service

**Preview State**:
The current readiness of a Wired Preview and the likely next action needed from the user or Preview Wiring Session.
_Avoid_: hidden health code, deployment status

**Browser-Direct Preview Service**:
A Preview Dependency Service that must be reachable directly by the Enrolled Device browser for the app to work.
_Avoid_: accidental exposed backend, hidden dependency

## Relationships

- A **Codex Host** runs zero or more **OpenCozy Sessions**.
- An **Enrolled Device** may reach the **Codex Host** through **Private WAN Access**.
- **Private WAN Access** preserves the trusted-device boundary; it does not authorize anonymous or public clients.
- The **Vendor-Neutral LAN Path** remains supported. Tailscale may be the recommended first Private WAN Access provider, but OpenCozy must not require it for direct LAN use.
- In Private WAN Access mode, Enrolled Devices should use one **OpenCozy Origin**. The backend should stay localhost-only behind that origin rather than being directly reachable as a second WAN endpoint.
- The first Tailscale-based Private WAN Access path may use the **Developer OpenCozy Origin** rather than a separate production-style server.
- Tailscale-based Private WAN Access should set the backend host to `127.0.0.1`; LAN development may keep `0.0.0.0` for same-network browser access.
- The first Tailscale-based **Developer OpenCozy Origin** may bind to `0.0.0.0` for setup simplicity, but accepted hostnames must be explicit through `OPENCOZY_ALLOWED_HOSTS`.
- Recommended Tailscale-based Private WAN Access must use HTTPS for the browser-facing **OpenCozy Origin**, preferably by placing Tailscale Serve in front of the local Vite service. Plain HTTP remains acceptable for the **Vendor-Neutral LAN Path**.
- Tailscale Serve is the recommended Tailscale exposure mechanism because it is tailnet-private. Tailscale Funnel is unsupported for OpenCozy until OpenCozy has app-level authentication and internet-facing hardening.
- Tailscale-enrolled devices have the same OpenCozy trust level as LAN devices: any Enrolled Device that can reach the **OpenCozy Origin** can fully control Codex through OpenCozy.
- Tailscale identity headers are not part of first-version OpenCozy authorization. Tailnet enrollment is the trust boundary.
- First-version Private WAN Access should rely on explicit host/origin allowlisting as the OpenCozy-side guardrail. It should not add a shared bearer token unless OpenCozy later introduces app-level authentication.
- The backend should enforce the same explicit host/origin allowlist when configured, including WebSocket upgrades, even when the recommended Tailscale setup keeps the backend bound to localhost.
- OpenCozy should remain a **Network-Agnostic PWA**; LAN and Tailscale reachability should not create separate UX modes.
- An **OpenCozy Session** runs exactly one Codex CLI process.
- A **Session Tab** attaches one device to one **OpenCozy Session**.
- A device may have multiple **Session Tabs** active at once; inactive tabs stay mounted and connected.
- OpenCozy Session lists used to restore **Session Tabs** are device-scoped. A device must not auto-open another device's sessions just because they were updated more recently.
- **Session Tab Preferences** are device-local and are the only source for restoring open tabs and the active tab after reload. Backend recency is never a restore source.
- **Session Tab Preferences** store OpenCozy Session ids only. Tab text is always the shared **OpenCozy Session Name** returned by the backend summary.
- A **Codex Session** belongs to Codex, not OpenCozy.
- A **Mobile Terminal Surface** controls an **OpenCozy Session** without replacing Codex's terminal UI.
- A **Mobile Terminal Surface** may depend on the **Mobile Xterm Fork** rather than reaching into stock xterm private internals from app code.
- **Mobile Terminal Preferences** belong to the device, not to an **OpenCozy Session** or **Codex Session**.
- A **Project Preview** may attach an **OpenCozy Session** or **Session Tab** to one **Wired Preview**.
- The active **Wired Preview** attachment belongs to the shared **OpenCozy Session**, not to device-local **Session Tab Preferences**.
- Closing an **OpenCozy Session** or **Session Tab** should not detach, delete, or unpublish a **Wired Preview**; detach is an explicit action in preview settings.
- A **Wired Preview** starts from a user-confirmed **Project Directory** and is stored by the OpenCozy backend, not in device-local browser storage.
- **Wired Previews** are globally shared OpenCozy data: any **Enrolled Device** can search and attach to them, while **Session Tab Preferences** remain device-local.
- A **Wired Preview** should have a user-facing name.
- **Wired Preview** search should show all matching records, including stale or unpublished ones, with explanatory **Preview State** labels such as Ready, Needs start, Needs publish, Unreachable, or Manifest pending approval.
- A **Preview Manifest** may propose a **Wired Preview** name, but the user should confirm or edit the name before approval creates reusable global preview data.
- A **Preview Wiring Session** may start from a **Project Search Brief**, search the Codex Host for candidate project directories, and ask the user to confirm the intended **Project Directory** before creating or updating a **Wired Preview**.
- After a **Project Directory** is confirmed, a **Preview Wiring Session** may inspect it and run project commands to identify or start a **Preview Target**, but the session must remain visible to the user and must not infer a project from unrelated machine-wide recency.
- Preview wiring launch instructions must enter Codex as a process initial prompt argument that points to a local prompt file; OpenCozy should not queue or auto-type preview prompts through the WebSocket terminal input path after the PTY starts.
- For Wired Preview updates and recovery, OpenCozy should start a new visible **Preview Wiring Session** and reuse the backend **Wired Preview** data as prompt-file context, rather than injecting instructions into an already-running PTY.
- A **Wired Preview** may store the **OpenCozy Session** id of its most recent **Preview Wiring Session** so update and recovery actions can return to visible wiring context instead of starting hidden work.
- A **Preview Wiring Session** may submit a **Preview Manifest** directly to the local OpenCozy backend, but OpenCozy should persist or publish it only after user approval.
- **Preview Manifest** approval is required for material changes to a **Wired Preview**, including the Preview Target, dependency services, browser-direct services, commands, and published origins; unchanged resubmissions may be treated as already approved.
- **Preview Commands** may be stored as metadata on a **Wired Preview**, but OpenCozy should not supervise arbitrary app processes in the first Project Preview implementation.
- **Preview State** should explain likely recovery actions, such as starting the preview with stored **Preview Commands**, publishing the approved target, or returning to the **Preview Wiring Session**.
- A start/recovery action for **Preview Commands** should open a visible **Preview Wiring Session** with the commands ready as context, rather than running commands invisibly from the Project Preview UI.
- A **Project Directory** may have multiple **Wired Previews**.
- A **Wired Preview** has one **Preview Target**, zero or more **Preview Dependency Services**, and may have one **Preview Published Origin**.
- By default, only the **Preview Target** gets a **Preview Published Origin**; **Preview Dependency Services** should stay local to the Codex Host behind the app's normal server-side or proxy paths.
- A **Preview Dependency Service** may become a **Browser-Direct Preview Service** only when the app architecture requires the Enrolled Device browser to call it directly.
- Each **Browser-Direct Preview Service** should receive its own port-based private HTTPS **Preview Published Origin** rather than being path-mounted under the frontend origin.
- Browser-direct dependency publishing is explicit and limited to services marked `browserDirect`; ordinary **Preview Dependency Services** remain host-local and should not be published by bulk dependency actions.
- The **Preview Publisher** owns durable publish and unpublish state for **Preview Published Origins**; a **Preview Wiring Session** may identify what to publish, but it should not be the durable owner of tunnel commands.
- The first **Preview Publisher** implementation may use Tailscale Serve for private HTTPS origins, while the **Vendor-Neutral LAN Path** remains available through manually reachable preview URLs until a LAN publisher is explicitly designed.
- A **Preview Target** should stay inside the trusted private boundary and should not require exposing arbitrary developer app ports directly to the public internet.
- The first **Preview Published Origin** should be private, HTTPS, and port-based so the developer app owns `/`; path-mounted previews are rejected because they can conflict with app routes, assets, auth callbacks, cookies, redirects, and development server hot reload paths.
- The first Tailscale Serve **Preview Publisher** publishes the **Preview Target** through `tailscale serve --bg --https=<published-port> http://127.0.0.1:<local-proxy-port>/`, where the **Local Preview Proxy** forwards to the target origin with local request headers. It unpublishes explicitly with `tailscale serve --https=<published-port> off`.
- **Preview Published Origin** state distinguishes the browser-facing HTTPS port from the **Local Preview Proxy** port. If a local proxy port is occupied, OpenCozy should allocate another port from the configured proxy range and update the Tailscale Serve target rather than requiring developer app configuration changes.
- Publishing failures, including missing Tailscale daemon access, missing Tailscale DNS, offline node state, or unavailable HTTPS Serve certificates, should be reported as **Preview Published Origin** failure state rather than hidden terminal output.
- Opening **Project Preview** should show the attached **Wired Preview** first when the active **OpenCozy Session** has one; otherwise it should show searchable **Wired Previews** and a wire-new action together.
- The wire-new action should also remain available when a **Wired Preview** search has no results.

## Interface direction

OpenCozy should feel mobile-native and terminal-adjacent without pretending every control is a terminal command. Prefer simple, powerful UI: restrained surfaces, clear hierarchy, compact spacing, direct labels, and plain action rows with subtle separators. Avoid fake green terminal styling, decorative dollar-sign or prompt gimmicks, card-like option buttons, repetitive explanatory copy, and generic marketing-style empty states. The app can use the owl icon and OpenCozy name for identity, but main task screens should prioritize the current workflow over repeated branding.

The concrete UX guide lives in [docs/ux-guide.md](docs/ux-guide.md). New frontend work should follow that guide for pages, tabs, floating controls, prompts, modals, forms, and empty states.

## Example dialogue

> **Dev:** "Should OpenCozy show every old Codex conversation?"
> **Domain expert:** "Only if Codex exposes a stable list. Otherwise OpenCozy should start the Resume Picker and let Codex own that choice."

## Flagged ambiguities

- "session" can mean **OpenCozy Session** or **Codex Session**. OpenCozy owns active PTY processes; Codex owns conversation history.
- "terminal" does not mean a general shell. OpenCozy starts Codex commands only.
- "fork" means a small, maintained xterm-derived package with documented mobile patches, not a rewrite of terminal emulation.
- "preview" means **Project Preview** for a developer app tied to a **Wired Preview**, not a deployment or public sharing feature.
