# Security Policy

OpenCozy is intended for trusted local development, trusted LAN use, and explicitly enrolled private-network devices. It does not include user accounts, authentication, authorization, or hardened internet-facing deployment controls.

## Reporting a Vulnerability

If the GitHub repository has private vulnerability reporting enabled, use that. Otherwise, open a minimal public issue that describes the affected area without including exploit details, private Codex output, tokens, or machine-specific paths.

## Current Security Boundaries

- Treat the backend as trusted-local software.
- Do not expose the backend port or Vite dev server directly to the public internet.
- Any device that can reach OpenCozy can start or resume Codex as the local OS user.
- Private WAN access means a device-network boundary such as Tailscale Serve, not a public URL. Tailscale-enrolled devices have the same trust level as LAN devices.
- For Tailscale Serve, bind the backend to `127.0.0.1`, expose only the frontend OpenCozy origin, require HTTPS, and set `OPENCOZY_ALLOWED_HOSTS` to the exact LAN and tailnet hostnames you will use.
- Do not use Tailscale Funnel or any public internet tunnel for OpenCozy until the app has real authentication and internet-facing hardening.
- `OPENCOZY_ALLOWED_HOSTS` is a guardrail for browser-facing host/origin checks, including WebSocket upgrades. It is not a replacement for a trusted network boundary.
- Do not commit `.env`, `data/`, Codex session output, credentials, or personal logs.
- Review terminal output before sharing screenshots or logs.
