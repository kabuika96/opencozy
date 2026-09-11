# Security

Opencozy is a single-owner local control plane for an agent that can read files and execute commands with the host user's permissions. It has no application login or multi-user authorization boundary. Device identifiers partition UI data; they are not authentication credentials.

Keep backend and frontend listeners on loopback. For remote access, use Tailscale Serve with access restricted to your trusted devices and configure `LITEHARNESS_ALLOWED_HOSTS` to exact browser hostnames. Do not expose the app through Tailscale Funnel, public tunnels, or direct public listeners. Anyone who can reach the trusted app origin may exercise owner-level control.

Keep `.env`, Codex authentication, application databases, attachments, and shared assets private. Back up local data separately. Optional integrations may access local records or send messages; configure only integrations you intend to use. Approval cards convey a user's decision but do not sandbox the agent or replace its execution permissions.

## Reporting a vulnerability

Use GitHub's private vulnerability reporting on this repository when available: open the Security tab and choose “Report a vulnerability.” If the control is unavailable, open a minimal public issue requesting a private contact channel without including exploit details, credentials, private data, or a working exploit. Do not publish sensitive details until a private channel is established.

Provide affected versions or commit IDs, a minimal reproduction, impact, and sanitized logs. There is no guaranteed response time or supported release window yet; fixes target the current default branch.
