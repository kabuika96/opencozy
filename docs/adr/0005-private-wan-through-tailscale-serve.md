# Private WAN Through Tailscale Serve

Status: Accepted

Date: 2026-05-04

OpenCozy may support Private WAN Access for Enrolled Devices through Tailscale Serve, but the vendor-neutral LAN path remains the OSS baseline. The first WAN trajectory keeps OpenCozy as a developer-mode tool: the browser reaches a single HTTPS OpenCozy Origin served through Tailscale Serve, the Vite developer server may remain that origin, and the backend stays localhost-only behind it.

Tailscale-enrolled devices have the same trust level as LAN devices: any enrolled device that can reach the OpenCozy Origin can control Codex as the local OS user. OpenCozy should not use Tailscale identity headers or a shared bearer token for first-version authorization; tailnet enrollment is the trust boundary. Tailscale Funnel and other public internet exposure paths remain unsupported until OpenCozy adds app-level authentication and internet-facing hardening. When hostnames are configured, both the frontend origin and backend routes, including WebSocket upgrades, should enforce explicit host/origin allowlists as defense in depth.

Consequences:

- The recommended Tailscale configuration sets `OPENCOZY_HOST=127.0.0.1` so the backend remains local to the Codex Host.
- The Vite frontend may remain the browser-facing OpenCozy Origin in developer-mode deployments.
- `OPENCOZY_ALLOWED_HOSTS` is the explicit list of browser-facing LAN and tailnet hostnames accepted by the frontend and backend.
- HTTPS is required for the recommended Tailscale path through Tailscale Serve.
- The LAN path remains available without Tailscale.

References:

- [Tailscale Serve](https://tailscale.com/docs/features/tailscale-serve)
- [`tailscale serve` CLI](https://tailscale.com/docs/reference/tailscale-cli/serve)
