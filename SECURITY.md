# Security Policy

OpenCozy is intended for trusted local development and trusted LAN use. It does not include user accounts, authentication, authorization, or hardened internet-facing deployment controls.

## Reporting a Vulnerability

If the GitHub repository has private vulnerability reporting enabled, use that. Otherwise, open a minimal public issue that describes the affected area without including exploit details, private Codex output, tokens, or machine-specific paths.

## Current Security Boundaries

- Treat the backend as trusted-local software.
- Do not expose the backend port or Vite dev server directly to the public internet.
- Any device that can reach OpenCozy can start or resume Codex as the local OS user.
- Do not commit `.env`, `data/`, Codex session output, credentials, or personal logs.
- Review terminal output before sharing screenshots or logs.
